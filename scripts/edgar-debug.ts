/**
 * Focused debug of the two failing pieces.
 */
import { fmpGet } from "../server/data/providers/fmp.client";
import { listRecentThirteenFFilings, getInformationTable } from "../server/data/providers/edgar.adapter";
import { edgarFetchJson } from "../server/data/providers/edgar.client";

async function main() {
  console.log("== 1. Raw FMP /profile call ==");
  try {
    const p: any = await fmpGet("/profile", { symbol: "AAPL" });
    console.log("type:", typeof p, Array.isArray(p) ? "array" : "");
    console.log("keys:", Array.isArray(p) && p[0] ? Object.keys(p[0]).slice(0, 15) : (p ? Object.keys(p).slice(0, 15) : "null"));
    console.log("cusip:", Array.isArray(p) ? p[0]?.cusip : p?.cusip);
    console.log("sample:", JSON.stringify(Array.isArray(p) ? p[0] : p, null, 2).slice(0, 500));
  } catch (e: any) {
    console.log("FMP /profile threw:", e?.message);
  }

  console.log("\n== 2. Raw efts.sec.gov query ==");
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 100);
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=&forms=13F-HR` +
      `&dateRange=custom&startdt=${start.toISOString().slice(0, 10)}` +
      `&enddt=${end.toISOString().slice(0, 10)}&from=0`;
    console.log("URL:", url);
    const d: any = await edgarFetchJson(url);
    console.log("total:", d?.hits?.total);
    console.log("hits len:", d?.hits?.hits?.length);
    if (d?.hits?.hits?.[0]) {
      const s = d.hits.hits[0]._source;
      console.log("first hit:", { adsh: s.adsh, cik: s.ciks?.[0], name: s.display_names?.[0], date: s.file_date });
    }
  } catch (e: any) {
    console.log("efts query threw:", e?.message);
  }

  console.log("\n== 3. listRecentThirteenFFilings (bypass cache) ==");
  try {
    const filers = await listRecentThirteenFFilings(100, 200);
    console.log("filers:", filers.length);
    console.log("sample:", filers.slice(0, 3).map(f => f.filerName));
  } catch (e: any) {
    console.log("listRecentThirteenFFilings threw:", e?.message);
  }

  console.log("\n== 4. getInformationTable on real BlackRock 13F ==");
  try {
    // BlackRock CIK 0001364742 — grab their latest 13F
    const searchUrl =
      `https://efts.sec.gov/LATEST/search-index?q=&forms=13F-HR&ciks=0001364742&from=0`;
    const d: any = await edgarFetchJson(searchUrl);
    const h = d?.hits?.hits?.[0];
    if (h) {
      const s = h._source;
      console.log("BlackRock filing:", s.adsh, s.file_date);
      const rows = await getInformationTable({
        accession: s.adsh,
        accessionNoDashes: s.adsh.replace(/-/g, ""),
        cik: s.ciks[0].padStart(10, "0"),
        filerName: s.display_names[0],
        filedAt: s.file_date,
        form: s.form,
      }, "037833100"); // AAPL CUSIP
      console.log("AAPL rows in BlackRock 13F:", rows.length);
      console.log(rows[0]);
    } else {
      console.log("No BlackRock 13F found");
    }
  } catch (e: any) {
    console.log("info table fetch threw:", e?.message);
  }
}

main();
