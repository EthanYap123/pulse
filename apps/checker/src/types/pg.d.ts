// The few parts of node-postgres the checker uses. @types/pg pulls in Node's type
// definitions, which clash with the Workers types this package compiles against.
declare module "pg" {
  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number | null }>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
