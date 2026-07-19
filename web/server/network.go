package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/containers/gvisor-tap-vsock/pkg/services/dns"
	"github.com/containers/gvisor-tap-vsock/pkg/services/forwarder"
	"github.com/containers/gvisor-tap-vsock/pkg/tap"
	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"golang.org/x/net/websocket"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/network/arp"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/icmp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
)

const (
	guestSubnet  = "10.0.2.0/24"
	guestGateway = "10.0.2.2"
	guestDNS     = "10.0.2.3"
	gatewayMAC   = "52:55:0a:00:02:02"
)

// networkProxy is one isolated user-mode network for one browser VM. GraniteOS
// uses QEMU slirp's static addresses, so separate stacks are important: two
// guests on one virtual switch would both claim 10.0.2.15.
type networkProxy struct {
	stack     *stack.Stack
	switcher  *tap.Switch
	dnsUDP    net.PacketConn
	dnsTCP    net.Listener
	done      chan struct{}
	closeOnce sync.Once
}

func newNetworkProxy() (*networkProxy, error) {
	link, err := tap.NewLinkEndpoint(false, 1500, gatewayMAC, guestDNS, []string{guestGateway})
	if err != nil {
		return nil, fmt.Errorf("create network link: %w", err)
	}

	switcher := tap.NewSwitch(false)
	link.Connect(switcher)
	switcher.Connect(link)

	networkStack := stack.New(stack.Options{
		NetworkProtocols: []stack.NetworkProtocolFactory{
			ipv4.NewProtocol,
			arp.NewProtocol,
		},
		TransportProtocols: []stack.TransportProtocolFactory{
			tcp.NewProtocol,
			udp.NewProtocol,
			icmp.NewProtocol4,
		},
	})

	cleanupStack := true
	defer func() {
		if cleanupStack {
			networkStack.Close()
		}
	}()

	if failure := networkStack.CreateNIC(1, link); failure != nil {
		return nil, fmt.Errorf("create network interface: %s", failure)
	}

	dnsAddress := tcpip.AddrFrom4Slice(net.ParseIP(guestDNS).To4())
	if failure := networkStack.AddProtocolAddress(1, tcpip.ProtocolAddress{
		Protocol:          ipv4.ProtocolNumber,
		AddressWithPrefix: dnsAddress.WithPrefix(),
	}, stack.AddressProperties{}); failure != nil {
		return nil, fmt.Errorf("add DNS address: %s", failure)
	}

	_, parsedSubnet, err := net.ParseCIDR(guestSubnet)
	if err != nil {
		return nil, fmt.Errorf("parse guest subnet: %w", err)
	}
	subnet, failure := tcpip.NewSubnet(
		tcpip.AddrFrom4Slice(parsedSubnet.IP.To4()),
		tcpip.MaskFromBytes(parsedSubnet.Mask),
	)
	if failure != nil {
		return nil, fmt.Errorf("create guest subnet: %s", failure)
	}

	networkStack.SetRouteTable([]tcpip.Route{{Destination: subnet, NIC: 1}})
	networkStack.SetSpoofing(1, true)
	networkStack.SetPromiscuousMode(1, true)

	var natLock sync.Mutex
	nat := make(map[tcpip.Address]tcpip.Address)
	networkStack.SetTransportProtocolHandler(
		tcp.ProtocolNumber,
		forwarder.TCP(networkStack, nat, &natLock, false).HandlePacket,
	)
	networkStack.SetTransportProtocolHandler(
		udp.ProtocolNumber,
		forwarder.UDP(networkStack, nat, &natLock, false).HandlePacket,
	)

	dnsUDP, err := gonet.DialUDP(networkStack, &tcpip.FullAddress{
		NIC: 1, Addr: dnsAddress, Port: 53,
	}, nil, ipv4.ProtocolNumber)
	if err != nil {
		return nil, fmt.Errorf("listen for guest DNS over UDP: %w", err)
	}

	dnsTCP, err := gonet.ListenTCP(networkStack, tcpip.FullAddress{
		NIC: 1, Addr: dnsAddress, Port: 53,
	}, ipv4.ProtocolNumber)
	if err != nil {
		dnsUDP.Close()
		return nil, fmt.Errorf("listen for guest DNS over TCP: %w", err)
	}

	dnsServer, err := dns.New(dnsUDP, dnsTCP, nil)
	if err != nil {
		dnsUDP.Close()
		dnsTCP.Close()
		return nil, fmt.Errorf("create DNS forwarder: %w", err)
	}

	done := make(chan struct{})
	go serveDNS("UDP", done, dnsServer.Serve)
	go serveDNS("TCP", done, dnsServer.ServeTCP)

	cleanupStack = false
	return &networkProxy{
		stack: networkStack, switcher: switcher, dnsUDP: dnsUDP, dnsTCP: dnsTCP, done: done,
	}, nil
}

func serveDNS(protocol string, done <-chan struct{}, serve func() error) {
	err := serve()
	select {
	case <-done:
		return
	default:
	}
	if err != nil && !errors.Is(err, net.ErrClosed) {
		log.Printf("GraniteOS network DNS %s stopped: %v", protocol, err)
	}
}

func (proxy *networkProxy) close() {
	proxy.closeOnce.Do(func() {
		close(proxy.done)
		proxy.dnsUDP.Close()
		proxy.dnsTCP.Close()
		proxy.stack.Close()
	})
}

func networkHandler() http.Handler {
	return websocket.Server{
		Handshake: networkHandshake,
		Handler: func(ws *websocket.Conn) {
			ws.PayloadType = websocket.BinaryFrame

			proxy, err := newNetworkProxy()
			if err != nil {
				log.Printf("GraniteOS network initialization failed: %v", err)
				return
			}
			defer proxy.close()

			if err := proxy.switcher.Accept(context.Background(), ws, types.QemuProtocol); err != nil {
				log.Printf("GraniteOS network session ended: %v", err)
			}
		},
	}
}

func networkHandshake(config *websocket.Config, request *http.Request) error {
	origin, err := websocket.Origin(config, request)
	if err != nil || origin == nil {
		return errors.New("network WebSocket requires an origin")
	}
	if !strings.EqualFold(origin.Host, request.Host) {
		return errors.New("network WebSocket origin does not match host")
	}
	config.Origin = origin
	config.Location = &url.URL{
		Scheme: "ws",
		Host:   request.Host,
		Path:   request.URL.Path,
	}

	for _, protocol := range config.Protocol {
		if protocol == "binary" {
			config.Protocol = []string{"binary"}
			return nil
		}
	}
	return errors.New("network WebSocket requires the binary subprotocol")
}
