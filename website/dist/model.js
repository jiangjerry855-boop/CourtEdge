export function features(input){
 const rank=Math.log(input.a.rank)-Math.log(input.b.rank);
 return {log_rank_diff:rank,age_diff:input.a.age-input.b.age,qualifier_diff:Number(input.a.qualifier)-Number(input.b.qualifier),rank_x_wta:rank*(input.tour==='WTA'),rank_x_clay:rank*(input.surface==='Clay'),rank_x_grass:rank*(input.surface==='Grass'),rank_x_bo5:rank*(input.bestOf===5),rank_x_late:rank*(['QF','SF','F'].includes(input.round)),prior_hours_diff:(input.a.minutes-input.b.minutes)/60,prior_matches_diff:input.a.matches-input.b.matches};
}
export function predict(input,models){
 const x=features(input), result={};
 for(const key of ['strength','strength_workload']){
  const m=models[key], z=m.features.reduce((sum,k,i)=>sum+x[k]*m.coefficients[i],m.intercept??0);
  if(!Number.isFinite(z))throw new Error('Complete all pre-match inputs.');
  result[key]=1/(1+Math.exp(-z));
 }
 return result;
}
export function validate(input){
 if(!input.a.name.trim()||!input.b.name.trim())return 'Choose or enter two players.';
 if(input.a.name.trim().toLowerCase()===input.b.name.trim().toLowerCase())return 'Choose two different players.';
 if(input.tour==='WTA'&&input.bestOf===5)return 'This WTA model supports best-of-three matches.';
 const maxMatches={R64:1,R32:2,R16:3,QF:4,SF:5,F:6}[input.round];
 for(const key of ['a','b']){
  const p=input[key],label=key.toUpperCase();
  if(!Number.isFinite(p.rank)||p.rank<1||p.rank>3000||!Number.isInteger(p.rank))return `Player ${label}: enter a ranking from 1 to 3,000.`;
  if(!Number.isFinite(p.age)||p.age<13||p.age>60)return `Player ${label}: enter an age from 13 to 60.`;
  if(!Number.isInteger(p.matches)||p.matches<1||p.matches>maxMatches)return `Player ${label}: enter 1 to ${maxMatches} prior main-draw matches for this round.`;
  if(!Number.isFinite(p.minutes)||p.minutes<20*p.matches||p.minutes>600*p.matches)return `Player ${label}: enter complete prior minutes (20 to 600 per recorded match).`;
 }
 return '';
}
