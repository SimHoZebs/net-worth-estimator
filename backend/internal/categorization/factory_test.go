package categorization

import "testing"

func TestNewClassifierFromEnv(t *testing.T) {
	for _, test := range []struct {
		name    string
		env     map[string]string
		keyword bool
		version string
	}{
		{"blank endpoint is keyword-only", map[string]string{}, true, "keyword-v1"},
		{"whitespace endpoint is keyword-only", map[string]string{"ML_JUDGMENT_URL": "  "}, true, "keyword-v1"},
		{"kill switch forces keyword-only", map[string]string{"ML_JUDGMENT_URL": "http://127.0.0.1:8766", "ML_CATEGORIES": "0"}, true, "keyword-v1"},
		{"configured endpoint is composite", map[string]string{"ML_JUDGMENT_URL": "http://127.0.0.1:8766"}, false, "composite/ml-categories-v1+keyword-v1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			classifier := NewClassifierFromEnv(func(key string) string { return test.env[key] })
			if _, ok := classifier.(KeywordClassifier); ok != test.keyword {
				t.Fatalf("keyword=%v, classifier=%T", test.keyword, classifier)
			}
			if got := classifier.Version(); got != test.version {
				t.Fatalf("version=%q, want %q", got, test.version)
			}
		})
	}
}
