// Command import-business-logos downloads selected Logo.dev catalog assets into
// the runtime logo-dev directory. It writes only direct <key>.png children of
// an existing --dir and never edits the catalog itself.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
)

const logoDevSecretEnv = "LOGO_DEV_SECRET_KEY"

type logoImporter interface {
	Download(context.Context, string) ([]byte, error)
}

type importDependencies struct {
	newImporter func(string) (logoImporter, error)
	getenv      func(string) string
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	return runWithDependencies(args, stdout, stderr, importDependencies{
		newImporter: func(secret string) (logoImporter, error) {
			return businesslogos.NewLogoDevImporter(secret, nil)
		},
		getenv: os.Getenv,
	})
}

func runWithDependencies(args []string, stdout, stderr io.Writer, dependencies importDependencies) int {
	flags := flag.NewFlagSet("import-business-logos", flag.ContinueOnError)
	flags.SetOutput(stderr)
	directory := flags.String("dir", "", "existing output directory for direct <key>.png files")
	all := flags.Bool("all", false, "select every key in the Logo.dev domain allowlist")
	refresh := flags.Bool("refresh", false, "replace existing regular <key>.png files")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "usage: import-business-logos --dir DIR (--all | KEY...) [--refresh]")
		fmt.Fprintln(stderr, "--dir must already exist; files are written directly as DIR/<key>.png.")
		fmt.Fprintln(stderr, "existing files are skipped unless --refresh is set.")
		fmt.Fprintln(stderr, "set LOGO_DEV_SECRET_KEY in the environment; there is no key flag.")
	}
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*directory) == "" || (flags.NArg() == 0 && !*all) || (*all && flags.NArg() != 0) {
		flags.Usage()
		return 2
	}
	info, err := os.Stat(*directory)
	if err != nil || !info.IsDir() {
		fmt.Fprintln(stderr, "--dir must name an existing directory")
		return 2
	}
	keys, err := selectedLogoKeys(flags.Args(), *all)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	var importer logoImporter
	code := 0
	for index, key := range keys {
		target := filepath.Join(*directory, key+".png")
		targetInfo, statErr := os.Lstat(target)
		exists := statErr == nil
		if statErr != nil && !os.IsNotExist(statErr) {
			fmt.Fprintf(stderr, "%s: could not inspect the target: %v\n", key, statErr)
			code = 1
			continue
		}
		if exists {
			if !targetInfo.Mode().IsRegular() {
				fmt.Fprintf(stderr, "%s: target exists and is not a regular file\n", key)
				code = 1
				continue
			}
			if !*refresh {
				fmt.Fprintf(stdout, "%s: skipped (exists; use --refresh to replace)\n", key)
				continue
			}
		}

		if importer == nil {
			secret := dependencies.getenv(logoDevSecretEnv)
			if secret != "" {
				importer, err = dependencies.newImporter(secret)
			}
			if secret == "" || err != nil {
				fmt.Fprintf(stderr, "%s: LOGO_DEV_SECRET_KEY is missing or invalid\n", key)
				reportBatchStop(stderr, keys[index+1:], "LOGO_DEV_SECRET_KEY is missing or invalid")
				return 1
			}
		}

		data, downloadErr := importer.Download(context.Background(), key)
		if downloadErr != nil {
			fmt.Fprintf(stderr, "%s: %v\n", key, downloadErr)
			code = 1
			if isLogoDevBatchStop(downloadErr) {
				reportBatchStop(stderr, keys[index+1:], "account or quota failure")
				return 1
			}
			continue
		}
		if err := writeLogoAtomic(target, data); err != nil {
			fmt.Fprintf(stderr, "%s: could not replace the target: %v\n", key, err)
			code = 1
			continue
		}
		fmt.Fprintf(stdout, "%s: imported (%d bytes)\n", key, len(data))
	}
	return code
}

func selectedLogoKeys(arguments []string, all bool) ([]string, error) {
	domains := businesslogos.LogoDevDomains()
	var keys []string
	if all {
		for key := range domains {
			keys = append(keys, key)
		}
		sort.Strings(keys)
	} else {
		seen := make(map[string]bool, len(arguments))
		for _, key := range arguments {
			if !seen[key] {
				seen[key] = true
				keys = append(keys, key)
			}
		}
	}
	if len(keys) == 0 {
		return nil, errors.New("select at least one explicit key or --all")
	}
	for _, key := range keys {
		if _, ok := domains[key]; !ok || !safeLogoKey(key) {
			return nil, fmt.Errorf("unknown or unsafe Logo.dev catalog key %q", key)
		}
	}
	return keys, nil
}

func safeLogoKey(key string) bool {
	return key != "" && key != "." && key != ".." && filepath.Base(key) == key && !strings.ContainsAny(key, "/\\\x00")
}

func isLogoDevBatchStop(err error) bool {
	return errors.Is(err, businesslogos.ErrLogoDevUnauthorized) ||
		errors.Is(err, businesslogos.ErrLogoDevForbidden) ||
		errors.Is(err, businesslogos.ErrLogoDevCredits) ||
		errors.Is(err, businesslogos.ErrLogoDevRateLimited)
}

func reportBatchStop(stderr io.Writer, remaining []string, reason string) {
	for _, key := range remaining {
		fmt.Fprintf(stderr, "%s: not attempted (batch stopped: %s)\n", key, reason)
	}
}

func writeLogoAtomic(target string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+"-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer func() {
		_ = file.Close()
		_ = os.Remove(temporary)
	}()
	if err := file.Chmod(0o600); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(temporary, target)
}
