package csvio

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// strictUnmarshal rejects unknown JSON syntax errors but allows normal shapes.
// It exists so callers can decode inline JSON columns with clear errors.
func strictUnmarshal(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("json decode: %w", err)
	}
	return nil
}
