/* 대뇌피질(大腦皮質) — 의식 산출·출력 검증
   최종적으로 "밖으로 내보내는 산출물(index.html)"이 실제로 온전히 렌더되는지 검증한다.
   (이 부위가 과거 </style> 누락으로 페이지 전체가 죽었던 사고를 원천 차단한다.)
     · render-integrity : <style>가 <head> 안에서 닫히고, 인라인 스크립트가 전부 구문 유효
     · data-integrity   : books.js 파싱·비어있지 않음, rankings.json 파싱
     · output-report    : 건강 스냅샷을 brain_output.json으로 기록(사이트/README가 읽는 산출) */
const fs = require("fs"), path = require("path"), vm = require("vm");
const { ROOT, readBooks, runSteps } = require("../lib");

module.exports = {
  id: "cortex", ko: "대뇌피질", role: "의식 산출·출력 검증(렌더 무결성)",
  steps: [
    {
      id: "render-integrity", ko: "렌더 무결성(</style>·JS 구문)", tier: "routine", critical: true,
      run: async () => {
        const h = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
        const sc = h.indexOf("</style>"), hd = h.indexOf("</head>"), bd = h.search(/<body[\s>]/i);
        if (!(sc >= 0 && sc < hd && sc < bd)) throw new Error("구조 붕괴: </style>가 <head> 안에서 닫히지 않음");
        let bad = 0; const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m;
        while ((m = re.exec(h))) { try { new vm.Script(m[1]); } catch (e) { bad++; } }
        if (bad) throw new Error("인라인 스크립트 구문 오류 " + bad + "건");
        return { note: "OK(<style> 닫힘·스크립트 구문 정상)" };
      },
    },
    {
      id: "data-integrity", ko: "데이터 무결성(books·rankings)", tier: "routine",
      run: async () => {
        const B = readBooks();
        if (!B || !B.length) throw new Error("books.js 비어있음/파싱 실패");
        let rk = "없음"; try { const r = JSON.parse(fs.readFileSync(path.join(ROOT, "rankings.json"), "utf8")); rk = (Array.isArray(r) ? r.length : Object.keys(r).length) + "섹션"; } catch (e) {}
        return { note: B.length + "종 · 랭킹 " + rk };
      },
    },
    {
      id: "error-inbox", ko: "오류·신고 인박스 감시(중앙관리)", tier: "routine",
      run: async (ctx) => {
        // 사이트가 올린 err(런타임 오류)·report(사용자 신고)를 GAS 인박스에서 읽어
        // brain_errors.md로 정리 — /errors 커맨드와 사람이 보는 중앙 뷰. 새 항목이 오면 ⚠ 표시.
        let ep = "";
        try { ep = (fs.readFileSync(path.join(ROOT, "tools", "app_base.html"), "utf8").match(/GUIDE_ENDPOINT\s*=\s*"([^"]+)"/) || [])[1] || ""; } catch (e) {}
        if (!ep) return { note: "엔드포인트 미확인 — 스킵" };
        const r = await fetch(ep + "?events=1&n=200", { redirect: "follow" });
        const j = await r.json();
        const cnt = j.counts || {};
        // 조치 대상 = 우리 코드 오류(err) + 사용자 신고(report). err3p(타 출처 불투명)는 규모만 표기.
        const actionable = (j.events || []).filter((e) => e.event === "err" || e.event === "report");
        const total = (cnt.err || 0) + (cnt.report || 0);
        const noise3p = cnt.err3p || 0;
        const fresh = Math.max(0, total - (ctx.state.errSeen || 0));
        ctx.state.errSeen = total;
        const lines = actionable.slice(0, 30).map((e) => {
          let x = {}; try { x = JSON.parse(e.extra || "{}"); } catch (e2) {}
          return "- [" + String(e.at || "").slice(0, 16) + "] " + (e.event === "report" ? "🙋신고" : "💥오류") + ": " + (x.m || "") + (x.src ? " @" + x.src : "");
        });
        fs.writeFileSync(path.join(__dirname, "..", "brain_errors.md"),
          "# 🐞 오류·신고 인박스 (brain 자동 갱신)\n\n" +
          "조치 대상 " + total + "건" + (fresh ? " · 🆕 새 항목 " + fresh + "건 ⚠" : "") +
          " — 있으면 Claude Code에서 `/errors`\n" +
          "타 출처 노이즈(err3p, CDN·브라우저확장 불투명 오류, 조치 불가) " + noise3p + "건 — 참고용\n\n" +
          (lines.join("\n") || "(조치 대상 없음)") + "\n");
        return { note: "조치대상 " + total + "건" + (fresh ? " · 🆕 " + fresh + " ⚠" : "") + " · 3p노이즈 " + noise3p };
      },
    },
    {
      id: "output-report", ko: "건강 스냅샷 산출(brain_output.json)", tier: "routine",
      run: async (ctx) => {
        const out = { at: ctx.now.toISOString(), cycle: ctx.state.cycle, tiers: ctx.plan.tiers, health: ctx.health };
        try { fs.writeFileSync(path.join(__dirname, "..", "brain_output.json"), JSON.stringify(out, null, 2)); } catch (e) {}
        return { note: "스냅샷 기록" };
      },
    },
  ],
  async run(ctx) { return { steps: await runSteps(ctx, this, this.steps) }; },
};
