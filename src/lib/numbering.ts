import "server-only";
import type { Tx } from "./db";
import { fyOf } from "./dates";
import { DEFAULT_SERIES, formatNumber } from "./numbering-defaults";

export { DEFAULT_SERIES, formatNumber };

/**
 * Allocate the next number in a series atomically (INSERT … ON CONFLICT … RETURNING).
 * Call inside the same interactive transaction that saves the document so a
 * rollback also rolls back the counter — keeping invoice series gap-free.
 */
export async function nextDocumentNumber(tx: Tx, docType: string, date: Date, fyStartMonth: number): Promise<string> {
  const series =
    (await tx.documentSeries.findUnique({ where: { docType } })) ??
    (await tx.documentSeries.create({
      data: { docType, prefix: DEFAULT_SERIES.find((s) => s.docType === docType)?.prefix ?? docType.slice(0, 3) },
    }));
  const fy = fyOf(date, fyStartMonth);
  const fyLabel = series.includeFy ? fy.short : "ALL";
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "SeriesCounter" ("docType", "fyLabel", "lastNumber") VALUES (${docType}, ${fyLabel}, 1)
    ON CONFLICT ("docType", "fyLabel") DO UPDATE SET "lastNumber" = "SeriesCounter"."lastNumber" + 1
    RETURNING "lastNumber"`;
  const seq = Number(rows[0]!.lastNumber);
  return formatNumber(series.prefix, series.includeFy ? fy.short : null, seq, series.padding);
}
