type TokenKind = "number" | "identifier" | "plus" | "minus" | "star" | "slash" | "lparen" | "rparen" | "abs" | "rate" | "eof";

interface Token {
  kind: TokenKind;
  lexeme: string;
  value?: number;
  offset: number;
}

interface Context {
  postingAmounts: Map<string, number>;
  accountBalances: Record<string, number>;
  rate: number;
}

class Lexer {
  private pos = 0;

  constructor(private input: string) {}

  next(): Token {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return { kind: "eof", lexeme: "", offset: this.pos };
    }

    const ch = this.input[this.pos];

    if (ch >= "0" && ch <= "9") {
      return this.lexNumber();
    }

    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      return this.lexIdent();
    }

    const start = this.pos;
    this.pos += 1;

    switch (ch) {
      case "+": return { kind: "plus", lexeme: "+", offset: start };
      case "-": return { kind: "minus", lexeme: "-", offset: start };
      case "*": return { kind: "star", lexeme: "*", offset: start };
      case "/": return { kind: "slash", lexeme: "/", offset: start };
      case "(": return { kind: "lparen", lexeme: "(", offset: start };
      case ")": return { kind: "rparen", lexeme: ")", offset: start };
      default:
        throw new ParseError(`Unexpected character '${ch}'`, start);
    }
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && this.input[this.pos] === " ") {
      this.pos += 1;
    }
  }

  private lexNumber(): Token {
    const start = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] >= "0" && this.input[this.pos] <= "9") {
      this.pos += 1;
    }
    if (this.pos < this.input.length && this.input[this.pos] === ".") {
      this.pos += 1;
      while (this.pos < this.input.length && this.input[this.pos] >= "0" && this.input[this.pos] <= "9") {
        this.pos += 1;
      }
    }
    const lexeme = this.input.slice(start, this.pos);
    const value = Number(lexeme);
    if (!Number.isFinite(value)) {
      throw new ParseError(`Invalid number '${lexeme}'`, start);
    }
    return { kind: "number", lexeme, value, offset: start };
  }

  private lexIdent(): Token {
    const start = this.pos;
    while (
      this.pos < this.input.length &&
      ((this.input[this.pos] >= "a" && this.input[this.pos] <= "z") ||
        (this.input[this.pos] >= "A" && this.input[this.pos] <= "Z") ||
        (this.input[this.pos] >= "0" && this.input[this.pos] <= "9") ||
        this.input[this.pos] === "_")
    ) {
      this.pos += 1;
    }
    const lexeme = this.input.slice(start, this.pos);
    if (lexeme === "abs") {
      return { kind: "abs", lexeme, offset: start };
    }
    if (lexeme === "rate") {
      return { kind: "rate", lexeme, offset: start };
    }
    return { kind: "identifier", lexeme, offset: start };
  }
}

export class ParseError extends Error {
  constructor(message: string, public offset: number) {
    super(`${message} at position ${offset}`);
    this.name = "ParseError";
  }
}

class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(input: string): (context: Context) => number {
    const lexer = new Lexer(input);
    while (true) {
      const token = lexer.next();
      this.tokens.push(token);
      if (token.kind === "eof") {
        break;
      }
    }
    return this.expr();
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  private advance(): Token {
    const token = this.peek();
    if (this.pos < this.tokens.length) {
      this.pos += 1;
    }
    return token;
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private match(kind: TokenKind): Token | null {
    if (this.check(kind)) {
      return this.advance();
    }
    return null;
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    throw new ParseError(message, this.peek().offset);
  }

  private expr(): (context: Context) => number {
    let node = this.term();

    while (this.check("plus") || this.check("minus")) {
      const op = this.advance();
      const right = this.term();
      const left = node;
      node = op.kind === "plus"
        ? (ctx) => left(ctx) + right(ctx)
        : (ctx) => left(ctx) - right(ctx);
    }

    return node;
  }

  private term(): (context: Context) => number {
    let node = this.unary();

    while (this.check("star") || this.check("slash")) {
      const op = this.advance();
      const right = this.unary();
      const left = node;
      node = op.kind === "star"
        ? (ctx) => left(ctx) * right(ctx)
        : (ctx) => {
            const divisor = right(ctx);
            if (divisor === 0) {
              throw new EvalError("Division by zero");
            }
            return left(ctx) / divisor;
          };
    }

    return node;
  }

  private unary(): (context: Context) => number {
    if (this.match("minus")) {
      const operand = this.unary();
      return (ctx) => -operand(ctx);
    }

    return this.call();
  }

  private call(): (context: Context) => number {
    if (this.match("abs")) {
      this.consume("lparen", "Expected '(' after 'abs'");
      const arg = this.expr();
      this.consume("rparen", "Expected ')' after abs argument");
      return (ctx) => Math.abs(arg(ctx));
    }

    return this.primary();
  }

  private primary(): (context: Context) => number {
    if (this.match("lparen")) {
      const node = this.expr();
      this.consume("rparen", "Expected ')'");
      return node;
    }

    if (this.check("number")) {
      const token = this.advance();
      const value = token.value!;
      return () => value;
    }

    if (this.check("rate")) {
      this.advance();
      return (ctx) => ctx.rate;
    }

    if (this.check("identifier")) {
      const token = this.advance();
      const name = token.lexeme;
      return (ctx) => {
        const postingVal = ctx.postingAmounts.get(name);
        if (postingVal !== undefined) {
          return postingVal;
        }
        const accountVal = ctx.accountBalances[name];
        if (accountVal !== undefined) {
          return accountVal;
        }
        return 0;
      };
    }

    throw new ParseError(`Expected number, identifier, or '('`, this.peek().offset);
  }
}

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

export function parseArithmetic(input: string): (context: Context) => number {
  const parser = new Parser();
  return parser.parse(input);
}

export function evaluateArithmetic(input: string, context: Context): number {
  return parseArithmetic(input)(context);
}
