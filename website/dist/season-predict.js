import {drawMatchupChart, drawHistoryChart} from "./forecast-charts.js";

const surfaces = ["Hard", "Clay", "Grass"];
const formatPercent = value => (100 * value).toFixed(1) + "%";
const count = value => value.toLocaleString("en-US");
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function probability(model, a, b, settings) {
  if (!a || !b || a.tour !== b.tour || a.id === b.id) throw Error("Choose two different players from the same tour.");
  const { surface, format, rankA, rankB, minutesA, minutesB } = settings;
  if (!surfaces.includes(surface) || ![3, 5].includes(format) || (a.tour === "WTA" && format !== 3)) {
    throw Error("Choose a supported surface and match format.");
  }
  if (![rankA, rankB].every(rank => Number.isInteger(rank) && rank >= 1 && rank <= 3000)) {
    throw Error("Enter each player’s pre-match rank (1–3,000).");
  }
  if ((minutesA === null) !== (minutesB === null)) throw Error("Enter earlier-round minutes for both players, or leave both blank.");
  if (minutesA !== null && ![minutesA, minutesB].every(minutes => Number.isInteger(minutes) && minutes >= 20 && minutes <= 3600)) {
    throw Error("Enter 20–3,600 verified prior minutes per player. For a first round or incomplete history, leave both fields blank.");
  }
  const rank = Math.log(rankB / rankA);
  const overall = (a.ratings.All - b.ratings.All) / 400;
  const surfaceGap = (a.ratings[surface] - b.ratings[surface]) / 400;
  const wta = Number(a.tour === "WTA");
  const bestOfFive = Number(format === 5);
  const hours = minutesA === null ? 0 : Math.max(-5, Math.min(5, (minutesA - minutesB) / 60));
  const inputs = [rank, rank*wta, rank*bestOfFive, overall, surfaceGap, overall*wta, overall*bestOfFive, hours];
  const score = model.coefficients.reduce((sum, coef, i) => sum + coef * inputs[i], 0);
  return 1 / (1 + Math.exp(-score));
}

function playerFields(side) {
  return `<fieldset class="matchup-player"><legend>Player ${side}</legend>
    <label>Player<select data-player="${side}"></select></label>
    <label>Pre-match rank<input type="number" min="1" max="3000" data-rank="${side}"></label>
    <small data-rank-date="${side}"></small>
    <label>Earlier-round minutes (optional)<input type="number" min="20" max="3600" placeholder="Unknown" data-minutes="${side}"></label>
  </fieldset>`;
}

export function showPredictionLab(main, model) {
  const report = model.report;
  const total = report.test.All;
  main.innerHTML = `<div class="page-head"><div><h1>Prediction lab</h1>
    <p>Estimate either player’s chance of winning a completed singles match. Choose a hypothetical matchup and verify the rankings for your match.</p></div></div>
    <section class="panel matchup-panel">
      <div class="matchup-controls"><label>Tour<select id="forecast-tour"><option>ATP</option><option>WTA</option></select></label>
      <label>Surface<select id="forecast-surface">${surfaces.map(x=>`<option>${x}</option>`).join("")}</select></label>
      <label>Format<select id="forecast-format"><option value="3">Best of 3</option><option value="5">Best of 5</option></select></label></div>
      <div class="matchup-pair">${playerFields("A")}${playerFields("B")}</div>
      <p class="footnote">Enter minutes only when both players have recorded durations in every earlier main-draw round they played in this event. Blank fields omit the workload adjustment.</p>
      <div class="matchup-result" aria-live="polite"></div>
      <section class="forecast-figure" id="scenario-figure"><h2>Win probability by player rank</h2>
        <p>Each point varies Player A’s rank while keeping the other matchup inputs fixed. The dots mark the rank entered above.</p>
        <div class="scenario-chart"></div></section>
      <p class="footnote">Ratings snapshot · ${escape(report.as_of)}. Probabilities use prior results, surface, format, and the inputs above. Player ratings update with a new model snapshot.</p>
    </section>
    <section class="panel"><h2>How it performed on 2026 matches</h2>
      <p>Fitted on ${count(report.train)} matches from pre-2026 events. Model selection used ${count(report.selection.rank.n)} matches in 2025. The 2026 test covers ${count(total.selected.n)} matches across ${report.test_events} events. Earlier test results enter player ratings only when the event’s reporting window has passed.</p>
      <section class="forecast-figure"><div class="chart-heading"><h3>Did the favorites win as often as predicted?</h3>
        <label>Test sample <select id="chart-tour"><option value="All">Both tours</option><option>ATP</option><option>WTA</option></select></label></div>
        <p>Each month compares the favorite’s average pre-match probability with how often the favorite won. November includes results through November 5.</p>
        <div class="history-chart"></div></section>
      <div class="table-scroll"><table><thead><tr><th>2026 sample</th><th>Matches</th><th>Model accuracy</th><th>Rank-only accuracy</th><th>Model log loss</th><th>Rank-only log loss</th></tr></thead><tbody>
      ${Object.entries(report.test).map(([group,m])=>`<tr><th>${escape(group)}</th><td>${count(m.selected.n)}</td><td>${formatPercent(m.selected.accuracy)}</td><td>${formatPercent(m.rank.accuracy)}</td><td>${m.selected.log_loss.toFixed(4)}</td><td>${m.rank.log_loss.toFixed(4)}</td></tr>`).join("")}
      </tbody></table></div><p>Lower log loss rewards probabilities that put more weight on the observed winner. On 2025 validation matches, adding prior minutes changed log loss from ${report.selection.ratings.log_loss.toFixed(5)} to ${report.selection.ratings_workload.log_loss.toFixed(5)}. The difference was small.</p>
      <details><summary>Data and evaluation details</summary><p>${escape(report.scope)}</p>
      <p>Retirements, walkovers, round robins and matches missing either ranking fall outside the evaluated population. Most uncertainty comes from player form, health and limited recent surface history. Each source rank has its own observation date.</p>
      <p><a href="https://stats.tennismylife.org/tennis-match-database">TennisMyLife data source</a> · <a href="data/season-model.json" download>Fitted model and evaluation (JSON)</a> · <a href="#archive">October workload research model</a></p></details>
    </section>`;
  const get = selector => main.querySelector(selector);
  const sideField = (field, side) => get(`[data-${field}="${side}"]`);
  const tour = get("#forecast-tour");
  const format = get("#forecast-format");
  const surface = get("#forecast-surface");
  const result = get(".matchup-result");
  const scenarioFigure = get("#scenario-figure");
  const historyTour = get("#chart-tour");
  historyTour.onchange = () => drawHistoryChart(get(".history-chart"), report, historyTour.value);
  historyTour.onchange();
  let lookup;

  function setPlayer(side) {
    const player = lookup.get(sideField("player", side).value);
    sideField("rank", side).value = player?.rank ?? "";
    sideField("rank-date", side).textContent = player ? "Source rank recorded " + player.rank_date : "";
    sideField("minutes", side).value = "";
  }

  function update() {
    const selected = side => lookup.get(sideField("player", side).value);
    const minutes = side => sideField("minutes", side).value === "" ? null : sideField("minutes", side).valueAsNumber;
    try {
      const a = selected("A"), b = selected("B");
      const settings = {surface:surface.value, format:Number(format.value),
        rankA:sideField("rank","A").valueAsNumber, rankB:sideField("rank","B").valueAsNumber,
        minutesA:minutes("A"), minutesB:minutes("B")};
      const p = probability(model,a,b,settings);
      result.innerHTML = `<strong>Estimated win probability</strong><div class="forecast-sides"><span>${escape(a.name)} <b>${formatPercent(p)}</b></span><span>${escape(b.name)} <b>${formatPercent(1-p)}</b></span></div>
        <div class="prob-track" aria-hidden="true"><span style="width:${100*p}%"></span></div>`;
      scenarioFigure.hidden = false;
      drawMatchupChart(get(".scenario-chart"), model, a, b, settings, probability);
    } catch (error) {
      scenarioFigure.hidden = true;
      result.textContent = error.message;
    }
  }

  function setTour() {
    const profiles = model.profiles.filter(p => p.tour === tour.value);
    lookup = new Map(profiles.map(p=>[p.id,p]));
    const recent = profiles.filter(p => (Date.parse(report.as_of) - Date.parse(p.rank_date)) / 86400000 <= 42);
    const examples = recent.sort((a,b)=>a.rank-b.rank || b.rank_date.localeCompare(a.rank_date)).slice(0,2);
    const options = profiles.sort((a,b)=>a.name.localeCompare(b.name))
      .map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join("");
    ["A","B"].forEach((side,i)=>{
      const select = sideField("player",side);
      select.innerHTML = options;
      select.value = examples[i]?.id ?? profiles[i].id;
      setPlayer(side);
    });
    format.value = "3";
    format.disabled = tour.value === "WTA";
    update();
  }
  tour.onchange = setTour;
  format.onchange = surface.onchange = update;
  for (const side of ["A","B"]) {
    sideField("player",side).onchange = () => {setPlayer(side); update();};
    for(const field of ["rank","minutes"]) sideField(field,side).oninput = update;
  }
  setTour();
}
