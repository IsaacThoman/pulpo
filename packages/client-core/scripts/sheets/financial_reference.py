"""Independent Microsoft formula/validation exceptions to the LibreOffice oracle.

Only used by financial_oracle.py. No Pulpo code or results are imported. Sections
are named after MS-OI29500 18.17.7 functions and the Microsoft Support examples.
Keep raw LO caches alongside every differing reference result (and a reason).
"""
import calendar
import datetime as dt
import math
from openpyxl.utils.datetime import from_excel

NUM = '#NUM!'
VALUE = '#VALUE!'
class ExcelError(Exception): pass
def require(ok):
    if not ok: raise ExcelError(NUM)
def val(s):
    if s.startswith('#'): raise ExcelError(s)
    if s=='TRUE': return 1
    if s=='FALSE': return 0
    if s.startswith('{'): return [val(x) if not x.startswith('"') else x[1:-1] for x in s[1:-1].split(';')]
    if s.startswith('"'): raise ExcelError(VALUE)
    return float(s) if s else 0

def ymd(n):
    # The fake leap day and serial zero need explicit representations.
    if n==0: return (1900,1,0)
    if n==60: return (1900,2,29)
    d=from_excel(n+1 if n<0 else n)
    if isinstance(d,dt.time): return (1900,1,0)
    return d.year,d.month,d.day
def serial(y,m,d):
    if y==1900 and m==2 and d==29:return 60
    return (dt.datetime(y,m,1)-dt.datetime(1899,12,30)).days + d-1 - (1 if (y,m)<(1900,3) else 0)
def shift(anchor,months):
    y,m,d=ymd(anchor); eom=d==calendar.monthrange(y,m)[1]
    y,m=divmod(y*12+m-1+months,12);m+=1
    last=calendar.monthrange(y,m)[1]
    return serial(y,m,last if eom else min(d,last))
def days(a,b,basis):
    if a==b:return 0
    if basis not in (0,4):return b-a
    y1,m1,d1=ymd(a);y2,m2,d2=ymd(b)
    if basis==4: d1=min(30,d1);d2=min(30,d2)
    else:
        feb1=m1==2 and d1==calendar.monthrange(y1,m1)[1]
        feb2=m2==2 and d2==calendar.monthrange(y2,m2)[1]
        if d1==31 and d2==31:d1=d2=30
        elif d1==31:d1=30
        elif d1==30 and d2==31:d2=30
        elif feb1 and feb2:d1=d2=30
        elif feb1:d1=30
    return 360*(y2-y1)+30*(m2-m1)+d2-d1
def yf(a,b,basis):
    if basis!=1:return days(a,b,basis)/(365 if basis==3 else 360)
    y1,m1,d1=ymd(a);y2,m2,d2=ymd(b)
    within=y1==y2 or y2==y1+1 and (m1,d1)>=(m2,d2)
    if within:
        leap=y1==y2 and calendar.isleap(y1) or any(calendar.isleap(y) and a<=serial(y,2,29)<=b for y in range(y1,y2+1))
        den=366 if leap else 365
    else:den=sum(366 if calendar.isleap(y) else 365 for y in range(y1,y2+1))/(y2-y1+1)
    return (b-a)/den
def coupon_data(s,m,f,b):
    k=1
    while shift(m,-k*12//f)>s:k+=1
    prev=shift(m,-k*12//f);nxt=shift(m,-(k-1)*12//f)
    E=nxt-prev if b==1 else (365 if b==3 else 360)/f
    A=days(prev,s,b);DSC=E-A if b in (0,4) else nxt-s
    return prev,nxt,k,E,A,DSC
def fraction(start,end,anchor,f,b):
    # Enumerate coupon boundaries once, then integrate each overlap.
    if start==end:return 0
    k=0
    while shift(anchor,k*12//f)>start:k-=1
    while shift(anchor,(k+1)*12//f)<=start:k+=1
    total=0
    while shift(anchor,k*12//f)<end:
        prev=shift(anchor,k*12//f);nxt=shift(anchor,(k+1)*12//f)
        E=nxt-prev if b==1 else (365 if b==3 else 360)/f
        total+=days(max(start,prev),min(end,nxt),b)/E;k+=1
    return total

def reference(formula,lo):
    name,text=formula.split('(',1);raw=text[:-1].split(',')
    try:
        a=[val(s) for s in raw]
        def get(i,d=0):return a[i] if i<len(a) else d
        def integer(i,d=0):return math.trunc(get(i,d))
        def date(i):
            n=integer(i);require(0<=n<=2958465);return n
        def basis(i):
            b=integer(i);require(0<=b<=4);return b
        def freq(i):
            f=integer(i);require(f in (1,2,4));return f
        # MS docs specify NUM, while Calc exports Err:502 as VALUE and Err:523 as N/A.
        # Input errors propagate in Excel even when Calc treats a scalar as a bad range.
        if name in ('IPMT','PPMT'):
            require(a[1]>=1 and (a[1]<a[2]+1 if name=='IPMT' else a[1]<=a[2]))
        if name in ('CUMIPMT','CUMPRINC'):
            require(a[0]>0 and a[1]>0 and a[2]>0 and integer(3)>=1 and integer(4)>=integer(3) and integer(4)<=a[1] and get(5) in (0,1))
        if name in ('DB','DDB','VDB'):
            require(a[0]>=0 and a[1]>=0 and a[2]>0)
            if name=='DB':require(integer(3)>=1 and 1<=integer(4,12)<=12 and integer(3)<=a[2]+(integer(4,12)!=12))
            if name=='DDB':require(a[3]>0 and a[3]<=a[2] and get(4,2)>0)
            if name=='VDB':require(a[3]>=0 and a[4]>=a[3] and a[4]<=a[2] and get(5,2)>0)
        if name=='SYD':require(a[2]>0 and 0<a[3]<=a[2])
        if name in ('EFFECT','NOMINAL'):require(a[0]>0 and integer(1)>=1)
        if name in ('DOLLARDE','DOLLARFR'):
            require(integer(1)>=0)
            if integer(1)==0:raise ExcelError('#DIV/0!')
        if name=='PDURATION':require(all(x>0 for x in a))
        if name=='RRI':require(a[0]>0 and a[1]!=0)
        if name=='PMT':require(a[1]!=0)
        if name=='ISPMT' and a[2]==0:raise ExcelError('#DIV/0!')
        if name=='RATE':
            require(a[0]>0)
            # No root / failure to converge is NUM in Excel, never Calc's N/A.
            if lo=='#N/A' or isinstance(lo,(float,int)) and (lo<=-1 or abs(lo)>1e12):raise ExcelError(NUM)
        if name in ('IRR','MIRR'):
            flows=a[0] if isinstance(a[0],list) else [a[0]]
            has_pos=any(isinstance(v,(int,float)) and v>0 for v in flows)
            has_neg=any(isinstance(v,(int,float)) and v<0 for v in flows)
            if name=='IRR':require(has_pos and has_neg)
            elif not has_pos or not has_neg:raise ExcelError('#DIV/0!')
        if name in ('XNPV','XIRR'):
            vi,di=(1,2) if name=='XNPV' else (0,1)
            vs=a[vi] if isinstance(a[vi],list) else [a[vi]];ds=a[di] if isinstance(a[di],list) else [a[di]]
            if not all(isinstance(v,(int,float)) for v in vs):raise ExcelError(VALUE)
            if not all(isinstance(d,(int,float)) and 0<=math.trunc(d)<=2958465 for d in ds):raise ExcelError(VALUE)
            require(len(vs)==len(ds))
            if name=='XNPV':require(a[0]>0);require(all(d>=ds[0] for d in ds))
            else:require(any(v>0 for v in vs) and any(v<0 for v in vs));require(get(2,.1)>-1);require(len(set(ds))>1)
        if name in ('AMORLINC','AMORDEGRC'):
            b=basis(6);p=date(1);end=date(2);life=1/a[5] if a[5]>0 else 0
            require(a[0]>=0 and 0<=a[3]<a[0] and integer(4)>=0 and a[5]>0 and p<=end and b!=2)
            if name=='AMORDEGRC':require(life>=3 and not 4<life<5)
        securities={'ACCRINT','ACCRINTM','PRICE','YIELD','DURATION','MDURATION','PRICEDISC','YIELDDISC','DISC','INTRATE','RECEIVED','PRICEMAT','YIELDMAT','ODDFPRICE','ODDFYIELD','ODDLPRICE','ODDLYIELD','TBILLPRICE','TBILLEQ','TBILLYIELD'}
        if name.startswith('COUP'):securities.add(name)
        if name in securities:
            if name=='ACCRINT':
                start=date(0);first=date(1);end=date(2);f=freq(5);b=basis(6)
                require(start<end and a[3]>0 and (get(4,.001) if raw[4] else .001)>0)
            else:
                start=date(0);end=date(1);require(start<end)
                if name.startswith('COUP'):f=freq(2);b=basis(3)
                elif name in ('PRICE','YIELD'):f=freq(5);b=basis(6);require(a[2]>=0 and a[3]>=(0 if name=='PRICE' else 1e-300) and a[4]>0)
                elif name in ('DURATION','MDURATION'):f=freq(4);b=basis(5);require(a[2]>=0 and a[3]>=0)
                elif name in ('PRICEDISC','YIELDDISC','DISC','INTRATE','RECEIVED'):b=basis(4);require(a[2]>0 and a[3]>0)
                elif name=='ACCRINTM':b=basis(4);require(a[2]>0 and (get(3,.001) if len(raw)<4 or raw[3] else .001)>0)
                elif name in ('PRICEMAT','YIELDMAT'):
                    b=basis(5);issue=date(2);require(issue<start and a[3]>=0 and a[4]>=(1e-300 if name=='YIELDMAT' else 0))
                elif name.startswith('ODD'):
                    first=name.startswith('ODDF');i=4 if first else 3
                    issue=date(2);f=freq(i+3);b=basis(i+4)
                    require(issue<start and a[i]>=0 and a[i+1]>=(1e-300 if name.endswith('YIELD') else 0) and a[i+2]>0)
                    if first:
                        fc=date(3);require(start<fc<end);require(coupon_data(fc,end,f,b)[0]==fc)
                elif name.startswith('TBILL'):
                    require(a[2]>0);y,m,d=ymd(start);require(end<=serial(y+1,m,min(d,calendar.monthrange(y+1,m)[1])))
        if name.startswith('COUP') and start==0:
            prev,nxt,N,E,A,DSC=coupon_data(start,end,f,b)
            return dict(COUPDAYBS=A,COUPDAYS=E,COUPDAYSNC=DSC,COUPNCD=nxt,COUPNUM=N,COUPPCD=prev)[name],'excel-epoch-coupons'
        if name in ('PRICE','YIELD'):
            prev,nxt,N,E,A,DSC=coupon_data(start,end,f,b)
            coupon=100*a[2]/f
            def price(y):
                if N==1:return (a[4]+coupon)/(1+DSC/E*y/f)-A/E*coupon
                return sum(coupon/(1+y/f)**(k+DSC/E) for k in range(N))+a[4]/(1+y/f)**(N-1+DSC/E)-coupon*A/E
            if name=='PRICE':return price(a[3]),'excel-final-coupon'
            if N==1:
                if DSC==0:return NUM,'excel-division-by-zero'
                dirty=a[3]+A/E*coupon
                return (a[4]+coupon-dirty)/dirty*f*E/DSC,'excel-final-coupon'
            lo_y=-f+1e-6;hi_y=1
            while price(hi_y)>a[3]:hi_y*=2
            for _ in range(200):
                mid=(lo_y+hi_y)/2
                if price(mid)>a[3]:lo_y=mid
                else:hi_y=mid
            return (lo_y+hi_y)/2,'excel-final-coupon'
        if name=='YIELDDISC':
            t=yf(start,end,b)
            return (a[3]/a[2]-1)/t,'excel-day-basis'
        if name=='IPMT' and a[1]>a[2]:
            r,per,n,pv=a[:4];fv=get(4);typ=1 if get(5) else 0
            if r==0:return 0,'excel-ipmt-fractional-period'
            payment=-r*(fv+pv*(1+r)**n)/((1+r*typ)*((1+r)**n-1))
            balance=-(pv*(1+r)**(per-1)+payment*(1+r*typ)*((1+r)**(per-1)-1)/r)
            return balance*r/(1+r if typ else 1),'excel-ipmt-fractional-period'
        if name=='NPV' and isinstance(a[1],list) and any(isinstance(v,str) for v in a[1]):
            flows=[v for v in a[1] if isinstance(v,(int,float))]
            return sum(v/(1+a[0])**(i+1) for i,v in enumerate(flows)),'excel-npv-ignore-text'
        if name=='FVSCHEDULE' and isinstance(a[1],list) and any(isinstance(v,str) for v in a[1]):return VALUE,'excel-validation'
        if name=='RATE' and a[1]==0 and get(3)==0:return NUM,'excel-no-root'
        if name in ('DDB','VDB') and a[0]<a[1]:return 0,'excel-salvage-exceeds-cost'
        if name=='DB' and a[0]==0:return 0,'excel-zero-cost'
        if name=='DB' and a[0]<a[1]:
            r=math.floor((1-(a[1]/a[0])**(1/a[2]))*1000+.5)/1000
            first=a[0]*r*get(4,12)/12
            return first if integer(3)==1 else (a[0]-first)*(1-r)**(integer(3)-2)*r,'excel-db-formula'
        if name=='AMORDEGRC' and integer(4)==0:
            coef=1.5 if life<5 else 2 if life<=6 else 2.5
            return math.floor(a[0]*a[5]*coef*yf(date(1),date(2),b)+.5),'excel-amor-first-period'
        # Use the published Excel day basis (YEARFRAC algorithm in MS-OI29500),
        # rather than Calc's add-in date implementation which uses different February/31 rules.
        if name in ('ACCRINTM','PRICEDISC','DISC','INTRATE','RECEIVED','PRICEMAT','YIELDMAT'):
            t=yf(start,end,b)
            if name=='ACCRINTM':return (get(3,.001) if len(raw)<4 or raw[3] else .001)*a[2]*t,'excel-day-basis'
            if name=='PRICEDISC':return a[3]*(1-a[2]*t),'excel-day-basis'
            if name=='DISC':return (1-a[2]/a[3])/t,'excel-day-basis'
            if name=='INTRATE':return (a[3]/a[2]-1)/t,'excel-day-basis'
            if name=='RECEIVED':require(a[3]*t<1);return a[2]/(1-a[3]*t),'excel-day-basis'
            dim=yf(issue,end,b);acc=yf(issue,start,b)
            if name=='PRICEMAT':return 100*((1+a[3]*dim)/(1+a[4]*t)-a[3]*acc),'excel-day-basis'
            return ((1+a[3]*dim)/(a[4]/100+a[3]*acc)-1)/t,'excel-day-basis'
        if name.startswith('TBILL'):
            t=end-start
            if name=='TBILLPRICE':return 100*(1-a[2]*t/360),'excel-tbill-days'
            if name=='TBILLYIELD':return (100-a[2])/a[2]*360/t,'excel-tbill-days'
            # Microsoft's published formula applies across the entire accepted interval.
            return 365*a[2]/(360-a[2]*t),'excel-tbill-days'
        if name in ('DURATION','MDURATION'):
            prev,nxt,N,E,A,DSC=coupon_data(start,end,f,b)
            amounts=[(a[2]/f+(1 if i==N-1 else 0))/(1+a[3]/f)**i for i in range(N)]
            result=(N-1+DSC/E)/f if a[2]==0 else sum((i+DSC/E)*v for i,v in enumerate(amounts))/sum(amounts)/f
            return result/(1+a[3]/f) if name=='MDURATION' else result,'excel-duration-coupon-time'
        if name=='ACCRINT':
            begin=first if get(7,1)==0 and end>first else start
            return (get(4,.001) if raw[4] else .001)*a[3]/f*fraction(begin,end,first,f,b),'excel-accrint-quasi-coupons'
        if name.startswith('ODD'):
            coupon=100*a[i]/f
            if first:
                _,_,N,*_=coupon_data(fc,end,f,b);N+=1
                A=fraction(issue,start,fc,f,b);DFC=fraction(issue,fc,fc,f,b);DSC=fraction(start,fc,fc,f,b)
                def price(y):return (coupon*DFC/(1+y/f)**DSC+sum(coupon/(1+y/f)**(k+DSC) for k in range(1,N))+a[i+2]/(1+y/f)**(N-1+DSC)-coupon*A)
                if name=='ODDFPRICE':return price(a[i+1]),'excel-odd-coupon-formula'
                lo_y=-f+1e-6;hi_y=1
                while price(hi_y)>a[i+1]:hi_y*=2
                for _ in range(200):
                    mid=(lo_y+hi_y)/2
                    if price(mid)>a[i+1]:lo_y=mid
                    else:hi_y=mid
                return (lo_y+hi_y)/2,'excel-odd-coupon-formula'
            DC=fraction(issue,end,issue,f,b);A=fraction(issue,start,issue,f,b);DSC=fraction(start,end,issue,f,b)
            if name=='ODDLPRICE':return (a[i+2]+coupon*DC)/(1+a[i+1]*DSC/f)-coupon*A,'excel-odd-coupon-formula'
            return (a[i+2]+coupon*DC-a[i+1]-coupon*A)/(a[i+1]+coupon*A)*f/DSC,'excel-odd-coupon-formula'
        # Small, well-specified corner cases where Calc gives a number/error Excel forbids.
        if name=='NPV' and a[0]==-1:return '#DIV/0!','excel-division-by-zero'
        if name=='MIRR' and (a[1]==-1 or a[2]==-1):return '#DIV/0!','excel-division-by-zero'
        if name=='DB' and integer(3)==0:return NUM,'excel-validation'
        if name=='DDB' and a[3]<1:
            # Excel uses book values before and after the requested (fractional) period.
            rate=min(1,get(4,2)/a[2]);prior=a[0]*(1-rate)**max(0,a[3]-1);after=a[0]*(1-rate)**a[3]
            return max(0,prior-max(a[1],after)),'excel-ddb-fractional'
        if name=='AMORLINC' and integer(4)==0:return a[0]*a[5]*yf(a[1],a[2],b),'excel-amor-first-period'
        if name=='RATE' and lo=='#VALUE!':return NUM,'excel-iteration'
        if name in ('IRR','XIRR') and lo=='#N/A':return NUM,'excel-iteration'
        return lo,None
    except ExcelError as e:return str(e),'excel-validation'
    except (ValueError,ZeroDivisionError,OverflowError):return NUM,'excel-domain'
