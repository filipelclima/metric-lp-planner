/**
 * Sanity check against REAL Metric data. Run `npm run fixtures` (needs network access to
 * api.metric.xyz) to download tests/fixtures/*.bins.json; skipped when no fixtures exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { binPoolApr, parseBins } from "@/lib/calc";

const dir = join(__dirname, "fixtures");
const files = readdirSync(dir).filter((f) => f.endsWith(".bins.json"));

describe.skipIf(files.length === 0)("real bins fixtures", () => {
  for (const f of files) {
    it(`${f}: dailyFees×365/liq matches aprBps within ~1%`, () => {
      const data = parseBins(JSON.parse(readFileSync(join(dir, f), "utf8")));
      expect(data.windowDays).toBeGreaterThan(0);
      const checked = data.bins.filter((b) => b.hasData && b.aprBps !== null && b.aprBps > 0 && b.liquidity > 0);
      expect(checked.length).toBeGreaterThan(0);
      for (const b of checked) {
        const ours = binPoolApr(b);
        const theirs = b.aprBps! / 1e4;
        // 1% relative, with a 0.5bp absolute floor for rounding on tiny APRs
        expect(Math.abs(ours - theirs), `bin ${b.idx}: ${ours} vs ${theirs}`).toBeLessThanOrEqual(
          Math.max(0.01 * theirs, 0.5e-4),
        );
      }
    });
  }
});
