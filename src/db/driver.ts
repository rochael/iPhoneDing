export interface Statement {
  sql: string;
  params: unknown[];
}
export interface SqlDriver {
  rows(statement: Statement): Promise<unknown[][]>;
  objects(statement: Statement): Promise<Record<string, unknown>[]>;
  run(statement: Statement): Promise<number>;
  batch(statements: Statement[]): Promise<void>;
}
