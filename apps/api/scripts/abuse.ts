import { runAbuseCli } from "../src/abuse/operator-cli";
import { pool } from "../src/db/client";

/** Hosted abuse review CLI; see `src/abuse/operator-cli.ts`. */
async function main() {
  let code = 1;
  try {
    code = await runAbuseCli(process.argv.slice(2), {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    await pool.end();
  }
  process.exit(code);
}

void main();
