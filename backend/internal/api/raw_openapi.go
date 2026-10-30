package api

import (
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
)

// These identity routes run outside Huma. Describe
// their wire contracts here so the same generated client covers every request.
func documentRawRoutes(api huma.API) {
	spec := api.OpenAPI()
	registry := spec.Components.Schemas
	jsonContent := func(value any) map[string]*huma.MediaType {
		return map[string]*huma.MediaType{"application/json": {Schema: registry.Schema(reflect.TypeOf(value), true, "")}}
	}
	for _, route := range []struct {
		id, method, path string
		input, output    any
	}{
		{"get-auth-session", "GET", "/v1/auth/session", nil, authcontract.SessionResponse{}},
		{"logout", "POST", "/v1/auth/logout", nil, authcontract.LogoutResponse{}},
		{"get-account-profile", "GET", "/v1/auth/profile", nil, authcontract.AccountProfile{}},
		{"update-account-profile", "PATCH", "/v1/auth/profile", authcontract.AccountProfileUpdate{}, authcontract.AccountProfile{}},
		{"change-account-password", "POST", "/v1/auth/change-password", authcontract.AccountPasswordChange{}, authcontract.AccountPasswordChanged{}},
		{"list-account-sessions", "GET", "/v1/auth/sessions", nil, authcontract.AccountSessions{}},
		{"revoke-account-session", "DELETE", "/v1/auth/sessions", nil, authcontract.AccountSessionRevoked{}},
	} {
		op := &huma.Operation{
			OperationID: route.id, Method: route.method, Path: route.path,
			Responses: map[string]*huma.Response{"200": {Description: "Success"}},
		}
		if route.input != nil {
			op.RequestBody = &huma.RequestBody{Required: true, Content: jsonContent(route.input)}
		}
		if route.output != nil {
			op.Responses["200"].Content = jsonContent(route.output)
		}
		if route.id == "revoke-account-session" {
			op.Parameters = []*huma.Param{{Name: "id", In: "query", Required: true, Schema: &huma.Schema{Type: "string"}}}
		}
		spec.AddOperation(op)
	}
}
