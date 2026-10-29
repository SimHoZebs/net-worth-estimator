package sqlite

import (
	"context"
	"database/sql"
)

// accountDB and accountTx bind the scope explicitly named in every financial SQL
// statement. They never rewrite SQL or infer a tenant from request state.
type accountDB struct {
	*sql.DB
	accountID string
}

type accountTx struct {
	*sql.Tx
	accountID string
}

func accountArgs(accountID string, args []any) []any {
	return append(args, sql.Named("account_id", accountID))
}

func (d *accountDB) Exec(q string, args ...any) (sql.Result, error) {
	return d.DB.Exec(q, accountArgs(d.accountID, args)...)
}
func (d *accountDB) Query(q string, args ...any) (*sql.Rows, error) {
	return d.DB.Query(q, accountArgs(d.accountID, args)...)
}
func (d *accountDB) QueryRow(q string, args ...any) *sql.Row {
	return d.DB.QueryRow(q, accountArgs(d.accountID, args)...)
}
func (d *accountDB) Begin() (*accountTx, error) {
	return d.BeginTx(context.Background(), nil)
}
func (d *accountDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*accountTx, error) {
	tx, err := d.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &accountTx{Tx: tx, accountID: d.accountID}, nil
}
func (t *accountTx) Exec(q string, args ...any) (sql.Result, error) {
	return t.Tx.Exec(q, accountArgs(t.accountID, args)...)
}
func (t *accountTx) Query(q string, args ...any) (*sql.Rows, error) {
	return t.Tx.Query(q, accountArgs(t.accountID, args)...)
}
func (t *accountTx) QueryRow(q string, args ...any) *sql.Row {
	return t.Tx.QueryRow(q, accountArgs(t.accountID, args)...)
}
