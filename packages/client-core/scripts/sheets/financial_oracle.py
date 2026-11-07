#!/usr/bin/env python3
"""Generate a deterministic financial grid, recalculate with private-profile LO, save compact caches.
Run with ~/.cache/pulpo-sheets-venv/bin/python -I scripts/sheets/financial_oracle.py.
No runtime engine participates in producing expectations. See financial-oracle/README.md.
"""
import datetime as dt
import json
import pathlib
import subprocess
import tempfile
import runpy
import sys
import math
import openpyxl
from openpyxl.utils.datetime import to_excel

ROOT = pathlib.Path(__file__).resolve().parents[2]
cases = {}
seeds = {}
def add(name, *args):
    args = [str(x) for x in args]
    f = name + '(' + ','.join(args) + ')'
    cases[f] = None
    seeds.setdefault(name, args)
def date(y,m,d): return str(int(to_excel(dt.datetime(y,m,d))))
s = date(2024,3,1); m = date(2027,8,31); issue = date(2023,10,15)
for basis in range(5):
    for freq in (1,2,4):
        for settle, mature in [(s,m),(date(2024,2,28),date(2025,2,28)),(date(2024,2,29),date(2028,2,29)),(date(2024,8,30),date(2026,8,31)),(date(2024,8,31),date(2026,8,31)),(date(2024,9,1),date(2026,8,31)),(date(2024,8,30),date(2024,8,31))]:
            for name in ('COUPDAYBS','COUPDAYS','COUPDAYSNC','COUPNCD','COUPNUM','COUPPCD'): add(name,settle,mature,freq,basis)
            for name in ('PRICE','YIELD'): add(name,settle,mature,.06,.07 if name=='PRICE' else 98,100,freq,basis)
            for name in ('DURATION','MDURATION'): add(name,settle,mature,.06,.07,freq,basis)
        for first in (date(2024,7,1),date(2024,2,29)):
            for settle in (date(2024,2,1),date(2024,7,1),date(2024,10,1),date(2026,3,1)):
                for method in ('TRUE','FALSE'):
                    add('ACCRINT',date(2024,1,1),first,settle,.1,1000,freq,basis,method)
        for first in (date(2024,8,31),date(2025,8,31)):
            for name in ('ODDFPRICE','ODDFYIELD'): add(name,s,m,issue,first,.06,.07 if name=='ODDFPRICE' else 98,100,freq,basis)
        for mature in (date(2024,4,15),date(2025,8,31)):
            for name in ('ODDLPRICE','ODDLYIELD'): add(name,s,mature,date(2023,12,31),.06,.07 if name=='ODDLPRICE' else 98,100,freq,basis)
    for settle,mature in [(s,m),(date(2024,2,29),date(2025,2,28)),(date(2024,8,30),date(2024,8,31))]:
        add('ACCRINTM',settle,mature,.1,1000,basis)
        for name in ('PRICEDISC','YIELDDISC','DISC'): add(name,settle,mature,.07 if name=='PRICEDISC' else 98,100,basis)
        for name in ('PRICEMAT','YIELDMAT'): add(name,settle,mature,issue,.06,.07 if name=='PRICEMAT' else 98,basis)
        add('INTRATE',settle,mature,1000,1100,basis)
        add('RECEIVED',settle,mature,1000,.07,basis)
    for name in ('AMORLINC','AMORDEGRC'):
        for rate in (.15,.2,.25,.3,.4,.5,1):
            for period in (0,1,4,6,10): add(name,2400,date(2008,8,19),date(2008,12,31),300,period,rate,basis)
for days in (1,181,182,183,364,365,366,367):
    for name in ('TBILLPRICE','TBILLEQ','TBILLYIELD'): add(name,s,int(s)+days,98 if name=='TBILLYIELD' else .09)
for rate in (0,.005,.1,-.01):
    for typ in (0,1):
        for n in (1,12,120):
            for name in ('PMT','FV','PV','NPER'):
                add(name,rate,n if name!='NPER' else -100,1000 if name!='PV' else -100,0,typ)
            for per in (1,n, n+.5):
                for name in ('IPMT','PPMT'): add(name,rate,per,n,1000,0,typ)
            for name in ('CUMIPMT','CUMPRINC'): add(name,rate,n,1000,1,n,typ)
for n in (1,12,120):
    for typ in (0,1):
        for guess in (-.1,0,.1): add('RATE',n,-100,1000,0,typ,guess)
for life in (1,2.5,10):
    for per in (.5,1,2,10,11):
        add('SLN',2400,300,life)
        add('SYD',2400,300,life,per)
        for month in (1,7,12): add('DB',2400,300,life,per,month)
        for factor in (1,1.5,2,5):
            add('DDB',2400,300,life,per,factor)
            for no_switch in ('TRUE','FALSE'): add('VDB',2400,300,life,per/2,per,factor,no_switch)
for flows in ('{-1000;200;300;700}','{-100;0;121}','{-100;230;-132}','{1;2;3}','{-1000;"x";1200}'):
    for r in (-.1,0,.1):
        add('NPV',r,flows); add('IRR',flows,r); add('MIRR',flows,r,.12)
for dates in ('{45000;45100;45365}','{45000;45365;45100}','{45000;44999;45365}','{45000;45100}','{-1;0;365}','{45000;45000;45000}','{45000;\"invalid\";45365}'):
    for r in (0,.1,-.1):
        add('XNPV',r,'{-1000;400;800}',dates); add('XIRR','{-1000;400;800}',dates,r)
add('XNPV',.1,'{-1000;"invalid";1200}','{45000;45100;45365}')
add('XIRR','{-1000;"invalid";1200}','{45000;45100;45365}')
for n in (-1,0,.5,1,2,4,12):
    for name in ('EFFECT','NOMINAL'): add(name,.05,n)
    for name in ('DOLLARDE','DOLLARFR'): add(name,-1.125,n)
    for name in ('PDURATION','RRI'): add(name,n,1000,1200)
add('ISPMT',.01,1,12,1000)
add('FVSCHEDULE',1000,'{0.1;0;-0.1}')
add('FVSCHEDULE',1000,'{0.1;"x"}')
# Use valid seeds so a bad earlier argument cannot hide an unread later one.
seeds.update(PMT=['.01','12','1000','0','0'],IPMT=['.01','2','12','1000','0','0'],PPMT=['.01','2','12','1000','0','0'],
    CUMIPMT=['.01','12','1000','1','12','0'],CUMPRINC=['.01','12','1000','1','12','0'],
    DB=['2400','300','10','2','7'],DDB=['2400','300','10','2','2'],VDB=['2400','300','10','1','2','2','FALSE'],
    EFFECT=['.05','4'],NOMINAL=['.05','4'],DOLLARDE=['1.125','16'],DOLLARFR=['1.125','16'],
    PDURATION=['.05','1000','1200'],RRI=['12','1000','1200'],RATE=['12','-100','1000','0','0','.1'])
# Every documented argument is independently exercised for type errors, error propagation,
# zero/negative boundaries and fractional truncation. Also omit every optional suffix.
mins = dict(PMT=3,IPMT=4,PPMT=4,FV=3,PV=3,NPER=3,RATE=3,IRR=1,XIRR=2,DB=4,DDB=4,VDB=5,ACCRINT=6,ACCRINTM=3,
    PRICE=6,YIELD=6,DURATION=5,MDURATION=5,PRICEDISC=4,YIELDDISC=4,DISC=4,INTRATE=4,RECEIVED=4,PRICEMAT=5,YIELDMAT=5,
    ODDFPRICE=8,ODDFYIELD=8,ODDLPRICE=7,ODDLYIELD=7,AMORLINC=6,AMORDEGRC=6,
    COUPDAYBS=3,COUPDAYS=3,COUPDAYSNC=3,COUPNCD=3,COUPNUM=3,COUPPCD=3)
for name,args in list(seeds.items()):
    for i in range(len(args)):
        for value in ('"invalid"','#N/A','0','-1','0.5'):
            a=args.copy(); a[i]=value; add(name,*a)
    for length in range(mins.get(name,len(args)),len(args)):
        add(name,*args[:length])
        a=args.copy(); a[length]=''; add(name,*a)

for name,args in seeds.items():
    if name.startswith('COUP'): indices=[(2,3),(3,5)]
    elif name in ('PRICE','YIELD'): indices=[(5,3),(6,5)]
    elif name in ('DURATION','MDURATION'): indices=[(4,3),(5,5)]
    elif name=='ACCRINT': indices=[(5,3),(6,5)]
    elif name in ('ACCRINTM','PRICEDISC','YIELDDISC','DISC','INTRATE','RECEIVED'): indices=[(4,5)]
    elif name in ('PRICEMAT','YIELDMAT'): indices=[(5,5)]
    elif name.startswith('ODDF'): indices=[(7,3),(8,5)]
    elif name.startswith('ODDL'): indices=[(6,3),(7,5)]
    elif name.startswith('AMOR'): indices=[(6,5)]
    else: indices=[]
    for index,value in indices:
        a=args.copy();a[index]=str(value);add(name,*a)
    if name.startswith(('COUP','TBILL')) or name in ('PRICE','YIELD','DURATION','MDURATION','PRICEDISC','YIELDDISC','DISC','INTRATE','RECEIVED','PRICEMAT','YIELDMAT'):
        a=args.copy();a[1]=a[0];add(name,*a)


# Exercise yield roots beyond the old fixed upper bound and zero-coupon duration.
add('PRICE',s,m,.06,20,100,2,1)
add('YIELD',s,m,.06,.001,100,2,1)
add('DURATION',s,m,0,1e10,2,1)
add('MDURATION',s,m,0,1e10,2,1)

reference = runpy.run_path(str(ROOT/'scripts/sheets/financial_reference.py'))['reference']
with tempfile.TemporaryDirectory(prefix='pulpo-financial-oracle-') as td:
    tmp=pathlib.Path(td); book=openpyxl.Workbook(); sheet=book.active
    for i,f in enumerate(cases,1):
        of=f
        if of.startswith(('PDURATION(', 'RRI(')): of='_xlfn.'+of
        sheet.cell(i,1,'='+of)
    book.save(tmp/'financial.xlsx')
    result=subprocess.run([str(ROOT/'scripts/sheets/lo_convert.sh'),str(tmp/'financial.xlsx'),str(tmp/'out'),'xlsx'],check=True,capture_output=True,text=True)
    info=json.loads(result.stdout)
    if not info['ok']: raise RuntimeError(info)
    cached=openpyxl.load_workbook(info['outputs'][0],data_only=True).active
    rows=[]
    for i,f in enumerate(cases,1):
        v=cached.cell(i,1).value
        if v is None: raise RuntimeError('Missing cache: '+f)
        expected, reason=reference(f,v)
        equal = expected==v or isinstance(expected,(float,int)) and isinstance(v,(float,int)) and math.isclose(expected,v,rel_tol=1e-10,abs_tol=1e-10)
        rows.append([f,v] if equal else [f,expected,reason,v])
    dest=ROOT/'test-fixtures/sheets/financial-oracle'; dest.mkdir(exist_ok=True)
    if '--check' in sys.argv:
        saved=[]
        for part in sorted(dest.glob('part-*.json')): saved.extend(json.loads(part.read_text()))
        if saved!=rows: raise RuntimeError('Financial oracle fixture is stale; regenerate it')
        print(json.dumps({'verified':len(rows)}));sys.exit(0)
    for old in dest.glob('part-*.json'): old.unlink()
    for part,start in enumerate(range(0,len(rows),1500)):
        (dest/f'part-{part+1}.json').write_text('[\n'+',\n'.join(json.dumps(row,separators=(',',':')) for row in rows[start:start+1500])+'\n]\n')
    print(json.dumps({'cases':len(rows),'functions':len(seeds),'conversion':info},indent=2))
