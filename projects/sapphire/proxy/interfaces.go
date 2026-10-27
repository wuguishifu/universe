package sapphireproxy

import (
	"net"
	"strconv"
	"strings"
	"sync"

	"tailscale.com/net/netmon"
)

// Android (API 30+) denies apps the netlink socket that Go's net.Interfaces
// uses, which leaves netmon unable to start. The Android host app calls
// SetInterfaces with the list from java.net.NetworkInterface before Start.
// Same workaround as Tailscale's own Android app.

var (
	ifaceMu sync.Mutex
	ifaces  []netmon.Interface
)

// SetInterfaces replaces the interface list reported to netmon. One interface
// per line: name|index|mtu|up|loopback|pointToPoint|multicast|addr/prefix,...
func SetInterfaces(spec string) {
	var list []netmon.Interface
	for line := range strings.SplitSeq(strings.TrimSpace(spec), "\n") {
		f := strings.Split(line, "|")
		if len(f) != 8 {
			continue
		}
		index, _ := strconv.Atoi(f[1])
		mtu, _ := strconv.Atoi(f[2])

		var flags net.Flags
		for i, flag := range []net.Flags{net.FlagUp, net.FlagLoopback, net.FlagPointToPoint, net.FlagMulticast} {
			if f[3+i] == "1" {
				flags |= flag
			}
		}

		var addrs []net.Addr
		for a := range strings.SplitSeq(f[7], ",") {
			if ip, ipnet, err := net.ParseCIDR(a); err == nil {
				addrs = append(addrs, &net.IPNet{IP: ip, Mask: ipnet.Mask})
			}
		}

		list = append(list, netmon.Interface{
			Interface: &net.Interface{Index: index, MTU: mtu, Name: f[0], Flags: flags},
			AltAddrs:  addrs,
		})
	}

	ifaceMu.Lock()
	first := ifaces == nil
	ifaces = list
	ifaceMu.Unlock()

	if first {
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			ifaceMu.Lock()
			defer ifaceMu.Unlock()
			return ifaces, nil
		})
	}
}
