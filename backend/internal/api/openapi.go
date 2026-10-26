package api

import (
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// openAPIComponentKeyPattern is the Components Object key rule.
// Code generators reject anything else, so the emitted spec must comply.
var openAPIComponentKeyPattern = regexp.MustCompile(`^[a-zA-Z0-9.\-_]+$`)

// waypointSchemaNamer wraps huma's default registry naming and strips
// characters the OpenAPI Components Object forbids. Huma derives generic
// instantiation names from reflection type strings, so
// EvaluationInstance[JsonValue] (JsonValue is an alias for any) would
// otherwise register as "EvaluationInstanceInterface {}", which fails code
// generators. Naming at registration keeps every $ref consistent, so the
// served spec needs no post-processing and wire schemas are unchanged.
func waypointSchemaNamer(t reflect.Type, hint string) string {
	name := huma.DefaultSchemaNamer(t, hint)
	clean := sanitizeOpenAPIComponentKey(name)
	if clean == "" {
		clean = sanitizeOpenAPIComponentKey(hint)
	}
	if clean == "" {
		clean = "Schema"
	}
	return clean
}

func sanitizeOpenAPIComponentKey(name string) string {
	var clean strings.Builder
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '-' || r == '_' {
			clean.WriteRune(r)
		}
	}
	return clean.String()
}

// checkOpenAPIComponentKeys reports component keys and dangling schema
// references. Tests fail on either; the served spec must stay generator-safe.
func checkOpenAPIComponentKeys(spec *huma.OpenAPI) error {
	names := make([]string, 0, len(spec.Components.Schemas.Map()))
	for key := range spec.Components.Schemas.Map() {
		names = append(names, key)
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		return fmt.Errorf("marshal spec: %w", err)
	}
	return checkOpenAPIKeys(names, raw)
}

func checkOpenAPIKeys(names []string, raw []byte) error {
	for _, key := range names {
		if !openAPIComponentKeyPattern.MatchString(key) {
			return fmt.Errorf("invalid schema key %q", key)
		}
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return fmt.Errorf("round-trip spec: %w", err)
	}
	var refs []string
	var walk func(node any)
	walk = func(node any) {
		switch value := node.(type) {
		case map[string]any:
			for field, child := range value {
				if field == "$ref" {
					if ref, ok := child.(string); ok {
						refs = append(refs, ref)
					}
					continue
				}
				walk(child)
			}
		case []any:
			for _, child := range value {
				walk(child)
			}
		}
	}
	walk(decoded)
	present := make(map[string]struct{}, len(names))
	for _, key := range names {
		present[key] = struct{}{}
	}
	for _, ref := range refs {
		const prefix = "#/components/schemas/"
		if !strings.HasPrefix(ref, prefix) {
			continue
		}
		if _, ok := present[strings.TrimPrefix(ref, prefix)]; !ok {
			return fmt.Errorf("dangling schema reference %q", ref)
		}
	}
	return nil
}
