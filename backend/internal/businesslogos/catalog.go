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
	"image"
	_ "image/png"
	"sort"
	"strings"
)

//go:embed logos/*.svg logos/*.png
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
	// LicenseURL is set only for assets that are not CC0. It lets the asset
	// handler attach the source license without a general attribution system.
	LicenseURL string
}

// PathPrefix is the only application path the browser uses for catalog logos.
// The versioned child path is an internal immutable target of a redirect from
// this stable path; clients never build it from user metadata.
const PathPrefix = "/v1/assets/business-logos/"

const (
	maxLogoBytes     = 16 << 10
	maxLogoDimension = 512
	svgLogoType      = "image/svg+xml"
	pngLogoType      = "image/png"
	pngFileSignature = "\x89PNG\r\n\x1a\n"
)

// logoFormat is the declared source encoding of a curated file. Content type
// comes from this declaration and never from a caller-supplied file name or
// MIME hint. Only the manifest opts a raster file in.
type logoFormat uint8

const (
	svgLogo logoFormat = iota
	pngLogo
)

type logoSpec struct {
	key        string
	file       string
	format     logoFormat
	licenseURL string
}

// Every supported key has exactly one checked-in asset and at least one alias.
// Keys mirror canonical issuer IDs where one exists. Brands without a
// verified distributable asset are deliberately absent: an unsupported name
// resolves to unknown and the generic account glyph stays visible.
var logoSpecs = []logoSpec{
	{key: "ally", file: "ally.svg", format: svgLogo},
	{key: "american-express", file: "americanexpress.svg", format: svgLogo},
	{key: "bank-of-america", file: "bankofamerica.svg", format: svgLogo},
	{key: "barclays", file: "barclays.svg", format: svgLogo},
	{key: "bmo", file: "bmo.svg", format: svgLogo},
	{key: "capital-one", file: "capitalone.svg", format: svgLogo},
	{key: "chase", file: "chase.svg", format: svgLogo},
	{key: "citi", file: "citi.svg", format: svgLogo},
	{key: "discover", file: "discover.svg", format: svgLogo},
	{
		key:        "fidelity-investments",
		file:       "fidelityinvestments.png",
		format:     pngLogo,
		licenseURL: "https://creativecommons.org/licenses/by-sa/4.0/",
	},
	{key: "klarna", file: "klarna.svg", format: svgLogo},
	{key: "netflix", file: "netflix.svg", format: svgLogo},
	{key: "paypal", file: "paypal.svg", format: svgLogo},
	{key: "pnc", file: "pnc.svg", format: svgLogo},
	{key: "spotify", file: "spotify.svg", format: svgLogo},
	{key: "truist", file: "truist.svg", format: svgLogo},
	{key: "uber", file: "uber.svg", format: svgLogo},
	{key: "us-bank", file: "usbank.svg", format: svgLogo},
	{key: "venmo", file: "venmo.svg", format: svgLogo},
	{key: "wells-fargo", file: "wellsfargo.svg", format: svgLogo},
}

// alias is a normalized token sequence matched on whole tokens. Single-token
// aliases are reserved for distinctive brands and are never ordinary words;
// punctuation and case changes normalize, partial and embedded substrings do
// not match. Each recognition scope opts in explicitly so a merchant alias
// cannot turn an account into that merchant, or vice versa.
type alias struct {
	tokens      []string
	bridge      bool
	manual      bool
	transaction bool
}

type matchScope uint8

const (
	bridgeMatch matchScope = iota
	manualMatch
	transactionMatch
)

type business struct {
	key     string
	aliases []alias
}

// Network names are intentionally absent. A network on a card is not the
// account business and must never displace a recognized issuer.
var businesses = []business{
	// "Ally" is an ordinary word and is never an alias by itself.
	{key: "ally", aliases: []alias{
		{tokens: []string{"ally", "bank"}, bridge: true, manual: true},
		{tokens: []string{"ally", "financial"}, bridge: true, manual: true},
	}},
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
	{key: "bmo", aliases: []alias{
		{tokens: []string{"bmo"}, bridge: true, manual: true},
		{tokens: []string{"bmo", "bank"}, bridge: true, manual: true},
		{tokens: []string{"bmo", "harris"}, bridge: true, manual: true},
		{tokens: []string{"bank", "of", "montreal"}, bridge: true, manual: true},
	}},
	// Capital One is named by the whole phrase. Bare "capital" and bare "one"
	// are ordinary words and never match, alone or as embedded substrings.
	{key: "capital-one", aliases: []alias{
		{tokens: []string{"capital", "one"}, bridge: true, manual: true},
		{tokens: []string{"capitalone"}, bridge: true, manual: true},
		{tokens: []string{"capital", "one", "bank"}, bridge: true, manual: true},
		{tokens: []string{"capital", "one", "financial"}, bridge: true, manual: true},
	}},
	{key: "chase", aliases: []alias{
		{tokens: []string{"chase"}, bridge: true, manual: true},
		{tokens: []string{"jpmorgan", "chase"}, bridge: true, manual: true},
		{tokens: []string{"chase", "bank"}, bridge: true, manual: true},
	}},
	{key: "citi", aliases: []alias{
		{tokens: []string{"citi"}, bridge: true, manual: true},
		{tokens: []string{"citibank"}, bridge: true, manual: true},
		{tokens: []string{"citigroup"}, bridge: true, manual: true},
		{tokens: []string{"citi", "bank"}, bridge: true, manual: true},
	}},
	{key: "discover", aliases: []alias{
		{tokens: []string{"discover"}, bridge: true, manual: true},
		{tokens: []string{"discover", "bank"}, bridge: true, manual: true},
	}},
	// Fidelity Investments is named only by distinctive multi-token forms.
	// The bare word "Fidelity" is shared with Fidelity Bank and Fidelity
	// International, so it is never an alias and is never substring-matched.
	{key: "fidelity-investments", aliases: []alias{
		{tokens: []string{"fidelity", "investments"}, bridge: true, manual: true},
		{tokens: []string{"fidelity", "brokerage", "services"}, bridge: true, manual: true},
		{tokens: []string{"fidelity", "netbenefits"}, bridge: true, manual: true},
		{tokens: []string{"netbenefits"}, bridge: true, manual: true},
		{tokens: []string{"fidelity", "brokerage"}, manual: true},
		{tokens: []string{"fidelity", "ira"}, manual: true},
		{tokens: []string{"fidelity", "401k"}, manual: true},
		{tokens: []string{"fidelity", "401", "k"}, manual: true},
	}},
	{key: "klarna", aliases: []alias{
		{tokens: []string{"klarna"}, bridge: true, manual: true, transaction: true},
	}},
	// Starter merchants are transaction-only. Their names identify a
	// counterparty, not the account or institution that reported the row.
	{key: "netflix", aliases: []alias{
		{tokens: []string{"netflix"}, transaction: true},
	}},
	{key: "paypal", aliases: []alias{
		{tokens: []string{"paypal"}, bridge: true, manual: true, transaction: true},
	}},
	{key: "pnc", aliases: []alias{
		{tokens: []string{"pnc"}, bridge: true, manual: true},
		{tokens: []string{"pnc", "bank"}, bridge: true, manual: true},
		{tokens: []string{"pnc", "financial", "services"}, bridge: true, manual: true},
	}},
	{key: "spotify", aliases: []alias{
		{tokens: []string{"spotify"}, transaction: true},
	}},
	{key: "truist", aliases: []alias{
		{tokens: []string{"truist"}, bridge: true, manual: true},
		{tokens: []string{"truist", "bank"}, bridge: true, manual: true},
		{tokens: []string{"truist", "financial"}, bridge: true, manual: true},
	}},
	{key: "uber", aliases: []alias{
		{tokens: []string{"uber"}, transaction: true},
	}},
	// Both "US Bank" and "U.S. Bank" normalize to distinct token sequences,
	// as do "US Bancorp" and "U.S. Bancorp". Bare "us" and bare "bank" never
	// match, and "US" alone is never treated as a business name.
	{key: "us-bank", aliases: []alias{
		{tokens: []string{"us", "bank"}, bridge: true, manual: true},
		{tokens: []string{"u", "s", "bank"}, bridge: true, manual: true},
		{tokens: []string{"us", "bancorp"}, bridge: true, manual: true},
		{tokens: []string{"u", "s", "bancorp"}, bridge: true, manual: true},
	}},
	{key: "venmo", aliases: []alias{
		{tokens: []string{"venmo"}, bridge: true, manual: true, transaction: true},
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
		contentType, err := validateLogo(data, spec.format)
		if err != nil {
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
			ContentType: contentType,
			LicenseURL:  spec.licenseURL,
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

// validateLogo validates the declared encoding only and returns the fixed
// content type for it. Both formats stay inside the same bounded payload.
func validateLogo(data []byte, format logoFormat) (string, error) {
	switch format {
	case svgLogo:
		if err := validateSVG(data); err != nil {
			return "", err
		}
		return svgLogoType, nil
	case pngLogo:
		if err := validatePNG(data); err != nil {
			return "", err
		}
		return pngLogoType, nil
	default:
		return "", fmt.Errorf("unsupported logo format %d", format)
	}
}

// validatePNG accepts a bounded, well-formed, reasonably sized PNG. The
// signature and decoded format agree so an unrelated image format cannot be
// served with an image/png content type. Catalog files are deliberately
// opted in; no user-supplied image reaches this path.
func validatePNG(data []byte) error {
	if len(data) == 0 || len(data) > maxLogoBytes {
		return fmt.Errorf("PNG payload length %d out of range", len(data))
	}
	if !bytes.HasPrefix(data, []byte(pngFileSignature)) {
		return fmt.Errorf("PNG has an unexpected signature")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != "png" {
		return fmt.Errorf("PNG could not be decoded: %v", err)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxLogoDimension || config.Height > maxLogoDimension {
		return fmt.Errorf("PNG dimensions %dx%d out of range", config.Width, config.Height)
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

// matches returns catalog keys named by one source in one recognition scope.
// More than one distinct key is ambiguous: callers keep the generic glyph
// rather than guessing between businesses.
func matches(text string, scope matchScope) []string {
	tokens := normalize(text)
	found := map[string]bool{}
	for _, candidate := range businesses {
		for _, item := range candidate.aliases {
			inScope := false
			switch scope {
			case bridgeMatch:
				inScope = item.bridge
			case manualMatch:
				inScope = item.manual
			case transactionMatch:
				inScope = item.transaction
			}
			if !inScope {
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

// decisiveMatch reports a key when the source resolves cleanly and reports
// decisive when it names any catalog business. An ambiguous source therefore
// stops precedence without choosing a later, weaker source.
func decisiveMatch(text string, scope matchScope) (key string, decisive bool) {
	keys := matches(text, scope)
	if len(keys) == 1 {
		return keys[0], true
	}
	return "", len(keys) > 1
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
		text  string
		scope matchScope
	}{
		{institution, bridgeMatch},
		{syncedName, bridgeMatch},
		{accountName, manualMatch},
	} {
		if key, decisive := decisiveMatch(source.text, source.scope); decisive {
			return key
		}
	}
	return ""
}

// RecognizeTransaction resolves a curated merchant from bank evidence in
// descending reliability: merchant_name, Payee, then the editable transaction
// name. Each source is evaluated independently with transaction-scoped aliases.
// The first source that names a catalog merchant is decisive, including an
// ambiguous result; later sources never break a tie. Account names, sync
// institutions, memos, and descriptions outside the editable name are not
// evidence, and recognition performs no I/O or model mutation.
func RecognizeTransaction(merchantName, payee, transactionName string) string {
	for _, text := range []string{merchantName, payee, transactionName} {
		if key, decisive := decisiveMatch(text, transactionMatch); decisive {
			return key
		}
	}
	return ""
}
