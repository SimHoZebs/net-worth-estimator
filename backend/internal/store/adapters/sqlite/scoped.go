package sqlite

import (
	"context"
	"database/sql"
)

// userDB and userTx bind the scope explicitly named in every financial
// SQL statement. They never rewrite SQL or infer a tenant from request state.
// Scope column is user_id referencing users(id); model-account
// references use model_account_id/bridge_account_id to avoid collision.
type userDB struct {
	*sql.DB
	userID string
}

type userTx struct {
	*sql.Tx
	userID string
}

func userArgs(userID string, args []any) []any {
	return append(args, sql.Named("user_id", userID))
}

func (d *userDB) Exec(q string, args ...any) (sql.Result, error) {
	return d.DB.Exec(q, userArgs(d.userID, args)...)
}
func (d *userDB) Query(q string, args ...any) (*sql.Rows, error) {
	return d.DB.Query(q, userArgs(d.userID, args)...)
}
func (d *userDB) QueryRow(q string, args ...any) *sql.Row {
	return d.DB.QueryRow(q, userArgs(d.userID, args)...)
}
func (d *userDB) Begin() (*userTx, error) {
	return d.BeginTx(context.Background(), nil)
}
func (d *userDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*userTx, error) {
	tx, err := d.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &userTx{Tx: tx, userID: d.userID}, nil
}
func (t *userTx) Exec(q string, args ...any) (sql.Result, error) {
	return t.Tx.Exec(q, userArgs(t.userID, args)...)
}
func (t *userTx) Query(q string, args ...any) (*sql.Rows, error) {
	return t.Tx.Query(q, userArgs(t.userID, args)...)
}
func (t *userTx) QueryRow(q string, args ...any) *sql.Row {
	return t.Tx.QueryRow(q, userArgs(t.userID, args)...)
}
