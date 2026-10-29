package sqlite

import (
	"context"
	"database/sql"
)

// planDB and planTx bind the scope explicitly named in every financial SQL
// statement. They never rewrite SQL or infer a tenant from request state.
type planDB struct {
	*sql.DB
	planID string
}

type planTx struct {
	*sql.Tx
	planID string
}

func planArgs(planID string, args []any) []any {
	return append(args, sql.Named("plan_id", planID))
}

func (d *planDB) Exec(q string, args ...any) (sql.Result, error) {
	return d.DB.Exec(q, planArgs(d.planID, args)...)
}
func (d *planDB) Query(q string, args ...any) (*sql.Rows, error) {
	return d.DB.Query(q, planArgs(d.planID, args)...)
}
func (d *planDB) QueryRow(q string, args ...any) *sql.Row {
	return d.DB.QueryRow(q, planArgs(d.planID, args)...)
}
func (d *planDB) Begin() (*planTx, error) {
	return d.BeginTx(context.Background(), nil)
}
func (d *planDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*planTx, error) {
	tx, err := d.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &planTx{Tx: tx, planID: d.planID}, nil
}
func (t *planTx) Exec(q string, args ...any) (sql.Result, error) {
	return t.Tx.Exec(q, planArgs(t.planID, args)...)
}
func (t *planTx) Query(q string, args ...any) (*sql.Rows, error) {
	return t.Tx.Query(q, planArgs(t.planID, args)...)
}
func (t *planTx) QueryRow(q string, args ...any) *sql.Row {
	return t.Tx.QueryRow(q, planArgs(t.planID, args)...)
}
