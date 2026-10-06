import {describe,expect,it} from "vitest";
import {parseMeasurementPair,summarize,welchTTest} from "../../lib/statistics";

describe("Experimentstatistik",()=>{
 it("berechnet reproduzierbare Stichprobenkennzahlen",()=>{const s=summarize([1,2,3,4]);expect(s.n).toBe(4);expect(s.mean).toBe(2.5);expect(s.variance).toBeCloseTo(1.6666667,6);});
 it("erkennt einen deutlichen Unterschied mit Welch-Test",()=>{const r=welchTTest([1,1.1,0.9,1.05,0.95],[2,2.1,1.9,2.05,1.95]);expect(r.pValue).toBeLessThan(0.05);expect(r.significantAt05).toBe(true);expect(r.effectSize).toBeGreaterThan(5);});
 it("weist ungültige Messbelege zurück",()=>{expect(()=>parseMeasurementPair("{}")) .toThrow();});
});
