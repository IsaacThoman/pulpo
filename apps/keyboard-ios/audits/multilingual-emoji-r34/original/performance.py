"""Paired optimized cost evidence. Parent-coordinated quiet window required."""
import argparse,datetime,hashlib,json,math,statistics,subprocess,time
from pathlib import Path

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def p95(xs):return sorted(xs)[math.ceil(len(xs)*.95)-1]
def summary(xs):return {'median':statistics.median(xs),'p95':p95(xs),'min':min(xs),'max':max(xs),'samples':xs}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def main():
 a=argparse.ArgumentParser();a.add_argument('--directory',required=True);a.add_argument('--queries',required=True);a.add_argument('--output',required=True);a.add_argument('--quiet-window',required=True);args=a.parse_args()
 d=Path(args.directory);output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
 result={'start':now(),'quietWindowCoordination':args.quiet_window,'hostAcceptance':'UNAVAILABLE pending independent raw host audit','measurements':[],'warmups':[],'processCaptures':[],'hashes':{n:digest(d/n) for n in ['baseline','candidate','baseline.json','candidate.json']},'querySHA256':digest(args.queries),'memoryLimitations':'macOS resident/peak include allocator slack and OS noise, not allocation attribution. Singleton peak sampled BEFORE controlled 15 extra indexes; retention shares decoded catalog. No native inference.'}
 def capture(stage):
  r=subprocess.run(['ps','-Ao','pid,stat,pcpu,comm'],text=True,capture_output=True,check=True)
  result['processCaptures'].append({'at':now(),'stage':stage,'raw':r.stdout})
 capture('before')
 for trial in range(14):
  # Two alternating warmups each, then 12 full alternating trials each.
  for version in ['baseline','candidate']:
   capture(f'{trial}-{version}-before')
   raw=d/f'raw-{trial}-{version}.json';proc=subprocess.Popen([str(d/version),str(d/f'{version}.json'),args.queries,str(raw)])
   while proc.poll() is None:
    capture(f'{trial}-{version}-during');time.sleep(.1)
   if proc.returncode:raise RuntimeError(f'{version} exit {proc.returncode}')
   x=json.loads(raw.read_text());x['rawSHA256']=digest(raw);x.pop('rawQueryMS');x.update({'trial':trial,'version':version,'finished':now()})
   result['warmups' if trial<2 else 'measurements'].append(x)
   capture(f'{trial}-{version}-after')
 capture('after')
 rows={v:[r for r in result['measurements'] if r['version']==v] for v in ['baseline','candidate']}
 result['summary']={v:{key:summary([r[key] for r in rows[v]]) for key in ['constructionMS','queryMedianMS','queryP95MS','queryMaxMS','additionalRetainedPerIndex','singletonPeak']} for v in rows}
 b,c=(result['summary'][v] for v in ['baseline','candidate'])
 resource=(d/'candidate.json').stat().st_size-(d/'baseline.json').stat().st_size
 retained=statistics.median([y['additionalRetainedPerIndex']-x['additionalRetainedPerIndex'] for x,y in zip(rows['baseline'],rows['candidate'])])
 peak=statistics.median([y['singletonPeak']-x['singletonPeak'] for x,y in zip(rows['baseline'],rows['candidate'])])
 result['pairedConstructionRatios']=[y['constructionMS']/x['constructionMS'] for x,y in zip(rows['baseline'],rows['candidate'])]
 result['deltas']={'resourceBytes':resource,'retainedPerIndexBytes':retained,'singletonPeakBytes':peak,'harnessBinaryBytes':(d/'candidate').stat().st_size-(d/'baseline').stat().st_size}
 result['numericGates']={'constructionMedian':c['constructionMS']['median']<=min(60,2*b['constructionMS']['median']),'constructionP95':c['constructionMS']['p95']<=min(60,2*b['constructionMS']['p95']),'queryP95':c['queryP95MS']['p95']<=min(2,max(2*b['queryP95MS']['p95'],b['queryP95MS']['p95']+.25)),'queryMax':c['queryMaxMS']['max']<=10,'retained':retained<=2*1048576,'peak':peak<=4*1048576,'resource':resource<=128*1024}
 result['finish']=now();result['unchangedAfter']={n:digest(d/n)==h for n,h in result['hashes'].items()}
 # Full captures stay outside Git; compact evidence retains every trial, raw-file digests.
 full=output.with_name(output.stem+'-full.json');full.write_text(json.dumps(result,indent=2)+'\n')
 captures=result.pop('processCaptures');result['fullRawEvidence']={'path':str(full),'sha256':digest(full),'processCaptureCount':len(captures)}
 output.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'numericGates':result['numericGates'],'hostAcceptance':result['hostAcceptance'],'output':str(output)}))
if __name__=='__main__':main()
