// Package storetest will provide the conformance gate for every Store adapter.
//
// TODO(purity): move RunConformance and its helpers here from
// backend/internal/store/adapters/sqlite (conformance_test.go plus
// test* helpers in sqlite *_test.go), importing only store ports.
// The sqlite adapter then keeps only TestStoreConformance calling
// storetest.Run. Until then, RunConformance lives in the sqlite package.
package storetest
