// Local runs reuse the API's test database settings (apps/api/.env). Variables already set,
// as in CI, take precedence.
import { config } from "dotenv";

config({ path: new URL("../../api/.env", import.meta.url), quiet: true });
