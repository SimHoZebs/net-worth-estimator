package accountdisplays

import (
	"os/exec"
	"testing"
)

func TestOperatorUpgrade(t *testing.T) {
	output, err := exec.Command("python3", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py").CombinedOutput()
	if err != nil {
		t.Fatalf("operator upgrade tests: %v\n%s", err, output)
	}
}
