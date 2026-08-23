package domain

import (
	"fmt"
	"math"
	"strconv"
	"sync"
)

// Arithmetic expression language ported from simulation/arithmetic.ts.
// Grammar: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
// unary := '-' unary | call ; call := 'abs' '(' expr ')' | primary ;
// primary := number | 'rate' | identifier | '(' expr ')'.

type tokenKind int

const (
	tokNumber tokenKind = iota
	tokIdentifier
	tokPlus
	tokMinus
	tokStar
	tokSlash
	tokLParen
	tokRParen
	tokAbs
	tokRate
	tokEOF
)

type token struct {
	kind   tokenKind
	lexeme string
	value  float64
	offset int
}

// ParseError reports a lexing/parsing failure with the input offset.
type ParseError struct {
	Message string
	Offset  int
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("%s at position %d", e.Message, e.Offset)
}

// EvalError reports an evaluation-time failure (division by zero).
type EvalError struct{ Message string }

func (e *EvalError) Error() string { return e.Message }

type lexer struct {
	input string
	pos   int
}

func (l *lexer) next() (token, error) {
	for l.pos < len(l.input) && l.input[l.pos] == ' ' {
		l.pos++
	}
	if l.pos >= len(l.input) {
		return token{kind: tokEOF, offset: l.pos}, nil
	}
	ch := l.input[l.pos]
	switch {
	case ch >= '0' && ch <= '9':
		return l.lexNumber()
	case (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_':
		return l.lexIdent()
	case ch == '+':
		l.pos++
		return token{kind: tokPlus, lexeme: "+", offset: l.pos - 1}, nil
	case ch == '-':
		l.pos++
		return token{kind: tokMinus, lexeme: "-", offset: l.pos - 1}, nil
	case ch == '*':
		l.pos++
		return token{kind: tokStar, lexeme: "*", offset: l.pos - 1}, nil
	case ch == '/':
		l.pos++
		return token{kind: tokSlash, lexeme: "/", offset: l.pos - 1}, nil
	case ch == '(':
		l.pos++
		return token{kind: tokLParen, lexeme: "(", offset: l.pos - 1}, nil
	case ch == ')':
		l.pos++
		return token{kind: tokRParen, lexeme: ")", offset: l.pos - 1}, nil
	default:
		return token{}, &ParseError{Message: fmt.Sprintf("Unexpected character '%c'", ch), Offset: l.pos}
	}
}

func (l *lexer) lexNumber() (token, error) {
	start := l.pos
	for l.pos < len(l.input) && l.input[l.pos] >= '0' && l.input[l.pos] <= '9' {
		l.pos++
	}
	if l.pos < len(l.input) && l.input[l.pos] == '.' {
		l.pos++
		for l.pos < len(l.input) && l.input[l.pos] >= '0' && l.input[l.pos] <= '9' {
			l.pos++
		}
	}
	lexeme := l.input[start:l.pos]
	value, err := strconv.ParseFloat(lexeme, 64)
	if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
		return token{}, &ParseError{Message: fmt.Sprintf("Invalid number '%s'", lexeme), Offset: start}
	}
	return token{kind: tokNumber, lexeme: lexeme, value: value, offset: start}, nil
}

func (l *lexer) lexIdent() (token, error) {
	start := l.pos
	for l.pos < len(l.input) {
		ch := l.input[l.pos]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' {
			l.pos++
			continue
		}
		break
	}
	lexeme := l.input[start:l.pos]
	switch lexeme {
	case "abs":
		return token{kind: tokAbs, lexeme: lexeme, offset: start}, nil
	case "rate":
		return token{kind: tokRate, lexeme: lexeme, offset: start}, nil
	}
	return token{kind: tokIdentifier, lexeme: lexeme, offset: start}, nil
}

// ParsedArithmetic is a compiled expression plus its identifier requirements.
// Closures may panic with *EvalError (division by zero); Evaluate converts
// that into an error.
type ParsedArithmetic struct {
	evaluate     func(ctx map[string]float64) float64
	requirements []string
}

func (p ParsedArithmetic) Evaluate(ctx map[string]float64) (result float64, err error) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(*EvalError); ok {
				result = 0
				err = e
				return
			}
			panic(r)
		}
	}()
	return p.evaluate(ctx), nil
}

func (p ParsedArithmetic) Requirements() []string { return p.requirements }

type parser struct {
	tokens       []token
	pos          int
	requirements map[string]bool
}

func (p *parser) peek() token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return p.tokens[len(p.tokens)-1]
}

func (p *parser) advance() token {
	t := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return t
}

func (p *parser) check(kind tokenKind) bool { return p.peek().kind == kind }

func (p *parser) match(kind tokenKind) bool {
	if p.check(kind) {
		p.advance()
		return true
	}
	return false
}

func (p *parser) consume(kind tokenKind, message string) (token, error) {
	if p.check(kind) {
		return p.advance(), nil
	}
	return token{}, &ParseError{Message: message, Offset: p.peek().offset}
}

func (p *parser) expr() (func(map[string]float64) float64, error) {
	leftNode, err := p.term()
	if err != nil {
		return nil, err
	}
	node := leftNode
	for p.check(tokPlus) || p.check(tokMinus) {
		op := p.advance()
		right, err := p.term()
		if err != nil {
			return nil, err
		}
		left := node
		if op.kind == tokPlus {
			node = func(ctx map[string]float64) float64 { return left(ctx) + right(ctx) }
		} else {
			node = func(ctx map[string]float64) float64 { return left(ctx) - right(ctx) }
		}
	}
	return node, nil
}

func (p *parser) term() (func(map[string]float64) float64, error) {
	unaryNode, err := p.unary()
	if err != nil {
		return nil, err
	}
	node := unaryNode
	for p.check(tokStar) || p.check(tokSlash) {
		op := p.advance()
		right, err := p.unary()
		if err != nil {
			return nil, err
		}
		left := node
		if op.kind == tokStar {
			node = func(ctx map[string]float64) float64 { return left(ctx) * right(ctx) }
		} else {
			node = func(ctx map[string]float64) float64 {
				divisor := right(ctx)
				if divisor == 0 {
					panic(&EvalError{Message: "Division by zero"})
				}
				return left(ctx) / divisor
			}
		}
	}
	return node, nil
}

func (p *parser) unary() (func(map[string]float64) float64, error) {
	if p.match(tokMinus) {
		operand, err := p.unary()
		if err != nil {
			return nil, err
		}
		return func(ctx map[string]float64) float64 { return -operand(ctx) }, nil
	}
	return p.call()
}

func (p *parser) call() (func(map[string]float64) float64, error) {
	if p.match(tokAbs) {
		if _, err := p.consume(tokLParen, "Expected '(' after 'abs'"); err != nil {
			return nil, err
		}
		arg, err := p.expr()
		if err != nil {
			return nil, err
		}
		if _, err := p.consume(tokRParen, "Expected ')' after abs argument"); err != nil {
			return nil, err
		}
		return func(ctx map[string]float64) float64 { return math.Abs(arg(ctx)) }, nil
	}
	return p.primary()
}

func (p *parser) primary() (func(map[string]float64) float64, error) {
	if p.match(tokLParen) {
		node, err := p.expr()
		if err != nil {
			return nil, err
		}
		if _, err := p.consume(tokRParen, "Expected ')'"); err != nil {
			return nil, err
		}
		return node, nil
	}
	if p.check(tokNumber) {
		t := p.advance()
		value := t.value
		return func(map[string]float64) float64 { return value }, nil
	}
	if p.match(tokRate) {
		p.requirements["rate"] = true
		return func(ctx map[string]float64) float64 { return ctx["rate"] }, nil
	}
	if p.check(tokIdentifier) {
		t := p.advance()
		name := t.lexeme
		p.requirements[name] = true
		return func(ctx map[string]float64) float64 {
			v, ok := ctx[name]
			if !ok {
				return math.NaN() // matches TS undefined propagation
			}
			return v
		}, nil
	}
	return nil, &ParseError{Message: "Expected number, identifier, or '('", Offset: p.peek().offset}
}

var exprCache = sync.Map{}

// ParseArithmetic compiles an arithmetic expression. Compiled expressions are
// memoized; expressions are immutable so sharing is safe across goroutines.
func ParseArithmetic(input string) (ParsedArithmetic, error) {
	if cached, ok := exprCache.Load(input); ok {
		return cached.(ParsedArithmetic), nil
	}
	lexer := &lexer{input: input}
	var tokens []token
	for {
		t, err := lexer.next()
		if err != nil {
			return ParsedArithmetic{}, err
		}
		tokens = append(tokens, t)
		if t.kind == tokEOF {
			break
		}
	}
	p := &parser{tokens: tokens, requirements: map[string]bool{}}
	expr, err := p.expr()
	if err != nil {
		return ParsedArithmetic{}, err
	}
	if _, err := p.consume(tokEOF, "Unexpected trailing input"); err != nil {
		return ParsedArithmetic{}, err
	}
	reqs := make([]string, 0, len(p.requirements))
	for name := range p.requirements {
		reqs = append(reqs, name)
	}
	sortStrings(reqs)
	parsed := ParsedArithmetic{evaluate: expr, requirements: reqs}
	exprCache.Store(input, parsed)
	return parsed, nil
}

func sortStrings(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
}

// ArithmeticRequirements returns sorted identifiers referenced by input.
func ArithmeticRequirements(input string) ([]string, error) {
	parsed, err := ParseArithmetic(input)
	if err != nil {
		return nil, err
	}
	return parsed.Requirements(), nil
}

// EvaluateArithmetic evaluates input against a concrete numeric context,
// defaulting missing requirement identifiers to 0 (legacy TS behavior).
func EvaluateArithmetic(input string, ctx map[string]float64) (float64, error) {
	parsed, err := ParseArithmetic(input)
	if err != nil {
		return 0, err
	}
	values := make(map[string]float64, len(parsed.requirements)+len(ctx))
	for k, v := range ctx {
		values[k] = v
	}
	for _, req := range parsed.requirements {
		if _, ok := values[req]; !ok {
			values[req] = 0
		}
	}
	return parsed.Evaluate(values)
}
