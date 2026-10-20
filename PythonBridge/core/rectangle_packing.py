"""Bounded, deterministic orthogonal packing of identical rectangular footprints.

Search strips, four-block interlocking patterns, then a bounded normal-coordinate
search for small layouts. Integer micrometres avoid geometric rounding overlap.
Conservative one-dimensional scaling provides valid quantity upper bounds.
A found layout is called optimal only when its count meets that bound.
"""
from dataclasses import dataclass
from functools import lru_cache
from decimal import Decimal

ALGORITHM = "mixed-blocks-v2"
MAX_BLOCK_CANDIDATES = 60000
MAX_EXACT_NODES = 3000

@dataclass(frozen=True)
class Layout:
    rectangles: tuple
    upper_bound: int
    search_limited: bool = False

    @property
    def optimal(self):
        return len(self.rectangles) == self.upper_bound

    def positions(self):
        return [dict(x=x/1000,y=y/1000,length=l/1000,width=w/1000)
                for x,y,l,w in self.rectangles]

def _grid(x,y,n,m,l,w):
    return [(x+i*l,y+j*w,l,w) for i in range(n) for j in range(m)]

def _strips(L,W,l,w,rotate):
    best=[]
    for transpose in (False,True):
        X,Y=(W,L) if transpose else (L,W)
        a,b=(w,l) if transpose else (l,w)
        options=[(a,b)]
        if rotate and a!=b:options.append((b,a))
        c,d=options[-1]
        for n in range(X//a+1):
            m=(X-n*a)//c if len(options)>1 else 0
            count=n*(Y//b)+m*(Y//d)
            if count<=len(best):continue
            if count>20000:raise ValueError("More than 20,000 units per layer; use larger load units.")
            places=_grid(0,0,n,Y//b,a,b)+_grid(n*a,0,m,Y//d,c,d)
            best=[(y,x,h,v) for x,y,v,h in places] if transpose else places
    return best

def _axis_bound(limit,l,w,a,b):
    # Every non-overlap constraint path contains n sides of length l and m of w.
    # Its mapped length is bounded by this exhaustive one-dimensional maximum.
    return max(a*n+b*((limit-n*l)//w) for n in range(limit//l+1))

def _upper_bound(L,W,l,w):
    bound=L*W//(l*w)
    pairs={(1,1)}
    for b in range(1,13):
        a=l*b//w
        pairs.update((v,b) for v in (a,a+1) if 1<=v<=64)
    for a,b in sorted(pairs):
        x=_axis_bound(L,l,w,a,b);y=_axis_bound(W,l,w,a,b)
        bound=min(bound,x*y//(a*b))
    return bound

def _indices(n,full):
    if full:return range(n+1)
    return sorted({0,1,min(2,n),min(3,n),n//4,n//2,3*n//4,
                   max(0,n-3),max(0,n-2),max(0,n-1),n})

def _interlocking(L,W,l,w,best,upper):
    # Four regular blocks meet in a spiral around a (possibly empty) centre.
    # No request-specific carton counts, dimensions, or fixed coordinates.
    limited=False
    for a,b,X,Y,transpose in ((l,w,L,W,False),(w,l,L,W,False),
                              (l,w,W,L,True),(w,l,W,L,True)):
        full=(X//a+1)*(Y//b+1)*(Y//a+1)*(X//b+1)<=MAX_BLOCK_CANDIDATES
        limited=limited or not full
        for cols in _indices(X//a,full):
            ax=cols*a;bc=(X-ax)//b
            for rows in _indices(Y//b,full):
                ay=rows*b;dr=(Y-ay)//a
                for br in _indices(Y//a,full):
                    by=br*a;cr=(Y-by)//b
                    for dc in _indices(X//b,full):
                        dx=dc*b;cc=(X-dx)//a
                        if not ((dx<=ax and by>=ay) or (dx>=ax and by<=ay)):continue
                        count=cols*rows+bc*br+dc*dr+cc*cr
                        if count<=len(best):continue
                        if count>20000:raise ValueError("More than 20,000 units per layer; use larger load units.")
                        places=(_grid(0,0,cols,rows,a,b)+_grid(ax,0,bc,br,b,a)
                                +_grid(0,ay,dc,dr,b,a)+_grid(dx,by,cc,cr,a,b))
                        best=[(y,x,h,v) for x,y,v,h in places] if transpose else places
                        if len(best)==upper:return best,limited
    return best,limited

def _normal_points(limit,l,w):
    return sorted({i*l+j*w for i in range(limit//l+1)
                   for j in range((limit-i*l)//w+1)}|{limit})

def _small_search(L,W,l,w,best,upper):
    # Atomic cells formed by normal coordinates allow exact overlap checks with
    # integer bitmasks. Explicit empty-cell branches admit non-strip arrangements.
    # Hard size/node limits bound request latency; exhaustion is NOT an optimum.
    if upper>60:return best,True
    xs=_normal_points(L,l,w);ys=_normal_points(W,l,w)
    nx,ny=len(xs)-1,len(ys)-1
    if nx*ny>400:return best,True
    xindex={x:i for i,x in enumerate(xs)};yindex={y:i for i,y in enumerate(ys)}
    bycell=[[] for _ in range(nx*ny)]
    for a,b in dict.fromkeys([(l,w),(w,l)]):
        for i,x in enumerate(xs):
            if x+a>L:continue
            for j,y in enumerate(ys):
                if y+b>W:continue
                cells=[v*nx+u for v in range(j,yindex[y+b]) for u in range(i,xindex[x+a])]
                mask=sum(1<<k for k in cells);place=(mask,(x,y,a,b))
                for k in cells:bycell[k].append(place)
    areas=[(xs[i+1]-xs[i])*(ys[j+1]-ys[j]) for j in range(ny) for i in range(nx)]
    full=(1<<(nx*ny))-1
    nodes=0;exhausted=False
    def find(target):
        seen={}
        def visit(used,free_area,chosen):
            nonlocal nodes,exhausted
            nodes+=1
            if nodes>MAX_EXACT_NODES:
                exhausted=True;return None
            if len(chosen)>=target:return chosen
            if len(chosen)+free_area//(l*w)<target or used==full:return None
            if seen.get(used,-1)>=len(chosen):return None
            seen[used]=len(chosen)
            empty=full^used;k=(empty&-empty).bit_length()-1
            for mask,rectangle in bycell[k]:
                if mask&used:continue
                answer=visit(used|mask,free_area-l*w,chosen+[rectangle])
                if answer is not None:return answer
                if exhausted:return None
            return visit(used|(1<<k),free_area-areas[k],chosen)
        return visit(0,L*W,[])
    while len(best)<upper:
        found=find(len(best)+1)
        if found is None:break
        best=found
    return best,exhausted or len(best)<upper

def _valid(places,L,W,l,w):
    # Only improved candidates need a quadratic check (small bounded layouts).
    for i,(x,y,a,b) in enumerate(places):
        if min(x,y)<0 or x+a>L or y+b>W or (a,b) not in ((l,w),(w,l)):return False
        for X,Y,A,B in places[i+1:]:
            if not(x+a<=X or X+A<=x or y+b<=Y or Y+B<=y):return False
    return True

@lru_cache(maxsize=64)
def _solve(L,W,l,w,rotate):
    if min(L,W,l,w)<=0:raise ValueError("Dimensions must be positive.")
    if max(L//min(l,w),W//min(l,w))>2000:
        raise ValueError("Dimensions create too many rows; use larger load units.")
    best=_strips(L,W,l,w,rotate)
    if not rotate or not best:
        return Layout(tuple(best),len(best))
    upper=_upper_bound(L,W,l,w)
    if len(best)==upper:return Layout(tuple(best),upper)
    improved,limited=_interlocking(L,W,l,w,best,upper)
    if len(improved)>len(best):
        if len(improved)<=200 and not _valid(improved,L,W,l,w):
            raise RuntimeError("Packing search produced an invalid interlocking layout.")
        best=improved
    if len(best)<upper:
        improved,limited_search=_small_search(L,W,l,w,best,upper)
        limited=limited or limited_search
        if len(improved)>len(best):
            if not _valid(improved,L,W,l,w):raise RuntimeError("Packing search produced an invalid layout.")
            best=improved
    return Layout(tuple(best),upper,limited and len(best)<upper)

def layout(length,width,box_length,box_width,rotate=True):
    values=tuple(int(Decimal(str(v))*1000) for v in (length,width,box_length,box_width))
    return _solve(*values,bool(rotate))
