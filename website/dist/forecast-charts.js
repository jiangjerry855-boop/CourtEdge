const percent = value => (100 * value).toFixed(1) + "%";
const number = value => value.toLocaleString("en-US");
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function lineChart(host, {points, labels, axis, inspectLabel, ticks, initial, description}) {
  const lower = ticks[0], upper = ticks[ticks.length - 1];
  const x = point => 100 * (point.x - points[0].x) / (points.at(-1).x - points[0].x || 1);
  const y = value => 100 * (upper - value) / (upper - lower);
  const path = key => points.map(point => x(point) + "," + y(point[key])).join(" ");
  const located = (point, key) => `left:${x(point)}%;top:${y(point[key])}%`;
  const step = Math.max(1, Math.ceil((points.length - 1) / 5));
  const tickPoints = points.filter((_, i) => i === points.length - 1 ||
    (i % step === 0 && (i === 0 || i <= points.length - 1 - step/2)));

  host.innerHTML = `<div class="chart-key">
      <span><i class="chart-swatch"></i>${escape(labels[0])}</span>
      <span><i class="chart-swatch alternate"></i>${escape(labels[1])}</span></div>
    <div class="chart-frame"><div class="chart-plot" role="img" aria-label="${escape(description)}">
      ${ticks.map(tick=>`<span class="chart-grid" style="top:${y(tick)}%"><small>${Math.round(tick*100)}%</small></span>`).join("")}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <polyline class="chart-a" points="${path("a")}"/><polyline class="chart-b" points="${path("b")}"/>
      </svg>
      ${points.filter(p=>p.dot).map(point=>`<i class="chart-dot" style="${located(point,"a")}"></i><i class="chart-dot alternate" style="${located(point,"b")}"></i>`).join("")}
      <i class="chart-guide"></i><i class="chart-marker"></i><i class="chart-marker alternate"></i>
      ${tickPoints.map(point=>`<small class="chart-xtick" style="left:${x(point)}%">${escape(point.tick)}</small>`).join("")}
    </div></div><div class="chart-axis">${escape(axis)}</div>
    <div class="chart-readout"><label>${escape(inspectLabel)} <select>
      ${points.map((p,i)=>`<option value="${i}">${escape(p.label)}</option>`).join("")}
    </select></label><output aria-live="off"></output></div>`;
  const plot = host.querySelector(".chart-plot");
  const select = host.querySelector("select");
  const output = host.querySelector("output");
  const guide = host.querySelector(".chart-guide");
  const markers = host.querySelectorAll(".chart-marker");
  function inspect(index) {
    const point = points[index];
    select.value = String(index);
    guide.style.left = x(point) + "%";
    for (const [i,key] of ["a","b"].entries()) {
      markers[i].style.cssText = located(point,key);
    }
    output.textContent = labels[0] + " " + percent(point.a) + "  ·  " + labels[1] + " " + percent(point.b)
      + (point.n ? "  ·  " + number(point.n) + " matches" : "");
  }
  function pointAt(event) {
    const box = plot.getBoundingClientRect();
    const position = 100 * (event.clientX - box.left) / box.width;
    const nearest = points.reduce((best,p,i) => Math.abs(x(p)-position) < Math.abs(x(points[best])-position) ? i : best, 0);
    inspect(nearest);
  }
  select.onchange = () => inspect(Number(select.value));
  plot.onpointermove = event => { if(event.pointerType === "mouse") pointAt(event); };
  plot.onclick = pointAt;
  inspect(initial);
}

export function drawMatchupChart(host, model, a, b, settings, probability) {
  const current = settings.rankA;
  const step = current <= 50 ? 1 : current <= 200 ? 5 : current < 1000 ? 25 : 50;
  const start = Math.max(1, Math.min(3000 - 16*step, current - 8*step));
  const ranks = new Set(Array.from({length:17}, (_,i)=>start+i*step));
  ranks.add(current);
  const points = [...ranks].sort((l,r)=>l-r).map(rank => {
    const predicted = probability(model,a,b,{...settings,rankA:rank});
    return {x:rank, a:predicted, b:1-predicted, tick:String(rank),
      label:rank === current ? "#" + rank + " (entered)" : "#" + rank, dot:rank === current};
  });
  lineChart(host,{points, labels:[a.name,b.name], axis:"Assumed pre-match rank for " + a.name + " (1 is best)",
    inspectLabel:"Inspect rank", ticks:[0,.25,.5,.75,1], initial:points.findIndex(p=>p.x===current),
    description:`Hypothetical win probabilities for ${a.name} and ${b.name} as ${a.name}’s rank varies. All other inputs are held fixed. Use Inspect rank for exact percentages.`});
}

export function drawHistoryChart(host, report, group) {
  const monthName = new Intl.DateTimeFormat("en-US", {month:"short",timeZone:"UTC"});
  const points = report.monthly[group].map(row=>{
    const month = monthName.format(new Date(row.month + "-01T00:00:00Z"));
    return {x:Number(row.month.slice(5)), a:row.predicted, b:row.observed, n:row.n,
      label:month + " " + row.month.slice(0,4), tick:month, dot:true};
  });
  // Use the same percentage scale for all three tour filters.
  const values = Object.values(report.monthly).flatMap(rows=>rows.flatMap(row=>[row.predicted,row.observed]));
  const bottom = Math.floor(10*Math.min(...values)), top = Math.ceil(10*Math.max(...values));
  const ticks = Array.from({length:Math.max(top-bottom,1)+1},(_,i)=>(bottom+i)/10);
  lineChart(host,{points,labels:["Predicted chance","Observed win rate"],axis:"Tournament start month · 2026",
    inspectLabel:"Inspect month",ticks,initial:points.length-1,
    description:"Monthly mean pre-match chance for the model favorite and the share of favorites who won. Use Inspect month for percentages and sample sizes."});
}
