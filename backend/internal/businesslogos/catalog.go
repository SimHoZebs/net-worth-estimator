// Package businesslogos owns the curated business-logo catalog and its
// catalog-only asset service. Recognition is computed response metadata: it
// never mutates the financial model, account kind, analysis state, or cache.
package businesslogos

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

//go:embed logos/*.svg
var logoFiles embed.FS

// Asset is one immutable, catalog-approved logo. ObjectKey is namespaced so a
// public asset reader can never address a private receipt object, even when
// both adapters are backed by the same provider.
type Asset struct {
	Key         string
	File        string
	ObjectKey   string
	SHA256      string
	Version     string
	Size        int64
	ContentType string
}

// PathPrefix is the only application path the browser uses for catalog logos.
// The versioned child path is an internal immutable target of a redirect from
// this stable path; clients never build it from user metadata.
const PathPrefix = "/v1/assets/business-logos/"

const maxLogoBytes = 16 << 10

type logoSpec struct {
	key  string
	file string
}

// Every supported key has exactly one checked-in SVG and at least one alias.
// Keys mirror canonical issuer IDs where one exists. Brands without a
// verified distributable asset are deliberately absent: an unsupported name
// resolves to unknown and the generic account glyph stays visible.
var logoSpecs = []logoSpec{
	{key: "american-express", file: "americanexpress.svg"},
	{key: "bank-of-america", file: "bankofamerica.svg"},
	{key: "barclays", file: "barclays.svg"},
	{key: "chase", file: "chase.svg"},
	{key: "discover", file: "discover.svg"},
	{key: "klarna", file: "klarna.svg"},
	{key: "paypal", file: "paypal.svg"},
	{key: "venmo", file: "venmo.svg"},
	{key: "wells-fargo", file: "wellsfargo.svg"},
}

// alias is a normalized token sequence matched on whole tokens. Single-token
// aliases are reserved for distinctive brands and are never ordinary words;
// punctuation and case changes normalize, partial and embedded substrings do
// not match. Manual and bridge sources carry separate opt-in flags.
type alias struct {
	tokens []string
	bridge bool
	manual bool
}

type business struct {
	key     string
	aliases []alias
}

// Network names are intentionally absent. A network on a card is not the
// account business and must never displace a recognized issuer.
var businesses = []business{
	{key: "american-express", aliases: []alias{
		{tokens: []string{"american", "express"}, bridge: true, manual: true},
		{tokens: []string{"amex"}, bridge: true, manual: true},
	}},
	{key: "bank-of-america", aliases: []alias{
		{tokens: []string{"bank", "of", "america"}, bridge: true, manual: true},
	}},
	{key: "barclays", aliases: []alias{
		{tokens: []string{"barclays"}, bridge: true, manual: true},
		{tokens: []string{"barclays", "bank"}, bridge: true, manual: true},
	}},
	{key: "chase", aliases: []alias{
		{tokens: []string{"chase"}, bridge: true, manual: true},
		{tokens: []string{"jpmorgan", "chase"}, bridge: true, manual: true},
		{tokens: []string{"chase", "bank"}, bridge: true, manual: true},
	}},
	{key: "discover", aliases: []alias{
		{tokens: []string{"discover"}, bridge: true, manual: true},
		{tokens: []string{"discover", "bank"}, bridge: true, manual: true},
	}},
	{key: "klarna", aliases: []alias{
		{tokens: []string{"klarna"}, bridge: true, manual: true},
	}},
	{key: "paypal", aliases: []alias{
		{tokens: []string{"paypal"}, bridge: true, manual: true},
	}},
	{key: "venmo", aliases: []alias{
		{tokens: []string{"venmo"}, bridge: true, manual: true},
	}},
	{key: "wells-fargo", aliases: []alias{
		{tokens: []string{"wells", "fargo"}, bridge: true, manual: true},
	}},
}

var manifest = func() map[string]Asset {
	result := make(map[string]Asset, len(logoSpecs))
	for _, spec := range logoSpecs {
		data, err := logoFiles.ReadFile("logos/" + spec.file)
		if err != nil {
			panic(fmt.Sprintf("read curated logo %s: %v", spec.key, err))
		}
		if err := validateSVG(data); err != nil {
			panic(fmt.Sprintf("curated logo %s: %v", spec.key, err))
		}
		digest := sha256.Sum256(data)
		hash := hex.EncodeToString(digest[:])
		result[spec.key] = Asset{
			Key:         spec.key,
			File:        spec.file,
			ObjectKey:   "businesslogo_" + spec.key + "_" + hash,
			SHA256:      hash,
			Version:     hash,
			Size:        int64(len(data)),
			ContentType: "image/svg+xml",
		}
	}
	return result
}()

// Assets returns the immutable manifest keyed by catalog key. Callers must
// treat returned values as read-only.
func Assets() map[string]Asset {
	copy := make(map[string]Asset, len(manifest))
	for key, asset := range manifest {
		copy[key] = asset
	}
	return copy
}

// Keys returns catalog keys in stable order.
func Keys() []string {
	keys := make([]string, 0, len(manifest))
	for key := range manifest {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// Lookup reports the manifest entry for a catalog key.
func Lookup(key string) (Asset, bool) {
	asset, ok := manifest[key]
	return asset, ok
}

// IsCatalogKey reports whether a string is a curated catalog key.
func IsCatalogKey(key string) bool {
	_, ok := manifest[key]
	return ok
}

// validateSVG rejects active content and external references at build time.
// Curated assets are static monochrome paths: no scripts, event handlers,
// remote fetches, embedded images, or use references.
func validateSVG(data []byte) error {
	if len(data) == 0 || len(data) > maxLogoBytes {
		return fmt.Errorf("SVG payload length %d out of range", len(data))
	}
	trimmed := bytes.TrimSpace(data)
	if !bytes.HasPrefix(trimmed, []byte("<svg")) || !bytes.HasSuffix(trimmed, []byte("</svg>")) {
		return fmt.Errorf("SVG has an unexpected envelope")
	}
	lower := strings.ToLower(string(trimmed))
	for _, forbidden := range []string{
		"<script", "javascript:", "data:", "xlink:href", "foreignobject",
		"<image", "<use", "@import", "url(", "onload=", "onerror=",
		"onclick=", "onmouseover=", "<iframe", "<style",
	} {
		if strings.Contains(lower, forbidden) {
			return fmt.Errorf("SVG contains forbidden token %q", forbidden)
		}
	}
	return nil
}

func normalize(text string) []string {
	var builder strings.Builder
	for _, r := range strings.ToLower(text) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			builder.WriteRune(r)
		} else {
			builder.WriteByte(' ')
		}
	}
	return strings.Fields(builder.String())
}

func containsSequence(tokens, phrase []string) bool {
	if len(phrase) == 0 || len(phrase) > len(tokens) {
		return false
	}
	for start := 0; start+len(phrase) <= len(tokens); start++ {
		if strings.Join(tokens[start:start+len(phrase)], " ") == strings.Join(phrase, " ") {
			return true
		}
	}
	return false
}

// matches returns catalog keys named by one source. More than one distinct
// key is ambiguous and yields no key: callers must fall back rather than
// guess between businesses.
func matches(text string, bridge bool) []string {
	tokens := normalize(text)
	found := map[string]bool{}
	for _, candidate := range businesses {
		for _, item := range candidate.aliases {
			if bridge && !item.bridge || !bridge && !item.manual {
				continue
			}
			if containsSequence(tokens, item.tokens) {
				found[candidate.key] = true
				break
			}
		}
	}
	keys := make([]string, 0, len(found))
	for key := range found {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// Recognize resolves one catalog key from source-supplied bridge identity and
// the owner's account name. Deterministic precedence is institution, synced
// bridge name, then manual account name. The first source that names any
// catalog business is decisive; when it names more than one, the result is
// unknown and later sources are not consulted. Names are a display signal
// only: no account kind, transaction, or network call is used. Visa and
// Mastercard are networks and are not catalog businesses, so they never
// override a recognized issuer on the same source.
func Recognize(institution, syncedName, accountName string) string {
	for _, source := range []struct {
		text   string
		bridge bool
	}{
		{institution, true},
		{syncedName, true},
		{accountName, false},
	} {
		keys := matches(source.text, source.bridge)
		if len(keys) == 1 {
			return keys[0]
		}
		if len(keys) > 1 {
			return ""
		}
	}
	return ""
}
