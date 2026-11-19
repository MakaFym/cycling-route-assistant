export function isEvidenceDate(value){
 if(typeof value!=='string')return false;
 const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
 if(!m)return false;
 const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1])return false;
 if(m[4]!==undefined&&(Number(m[4])>23||Number(m[5])>59||Number(m[6])>59))return false;
 if(m[7]&&m[7]!=='Z'&&(Number(m[7].slice(1,3))>23||Number(m[7].slice(4))>59))return false;
 return !Number.isNaN(Date.parse(value));
}
export function evidenceDay(value){
 if(!isEvidenceDate(value))throw Error('Invalid evidence date; use an existing YYYY-MM-DD or zoned ISO timestamp');
 return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
