package authorization

import (
	"strings"
)

// AllowPrivateHTTP reports whether plain-HTTP identity origins are enabled.
// Empty or unrecognized values mean disabled (HTTPS default). When enabled,
// the operator owns the network boundary: bind and expose plain HTTP only on
// a trusted private LAN.
func AllowPrivateHTTP(getenv func(string) string) bool {
	switch strings.ToLower(strings.TrimSpace(getenv("NET_WORTH_ESTIMATOR_ALLOW_PRIVATE_HTTP"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// IsLoopbackHost preserves the historical loopback set allowed for plain HTTP
// without the opt-in flag: localhost names and IPv4/IPv6 loopback literals.
func IsLoopbackHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	h = strings.TrimSuffix(h, ".")
	h = strings.TrimPrefix(h, "[")
	h = strings.TrimSuffix(h, "]")
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}
