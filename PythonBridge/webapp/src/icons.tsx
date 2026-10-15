import type {ButtonHTMLAttributes} from 'react';
const paths={
 cube:'m3 7 9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10',
 zoomIn:'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M14 14l7 7 M7 10h6 M10 7v6',
 zoomOut:'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M14 14l7 7 M7 10h6',
 topView:'M3 5h18v14H3z M12 2v6 m-3-3 3 3 3-3',
 analysis:'M3 3v18h18 M7 16v-5 M12 16V7 M17 16v-8 M6 7l5-3 5 1 5-3',
 copy:'M9 9h12v12H9z M5 15H3V3h12v2',
 attachment:'m8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3 M6 14l9-9',
 check:'m5 12 4 4L19 6',
 info:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 11v6 M12 7h.01',
 drag:'M8 5h.01 M16 5h.01 M8 12h.01 M16 12h.01 M8 19h.01 M16 19h.01',
 calculator:'M5 2h14v20H5z M8 5h8v4H8z M8 13h1 M12 13h1 M16 13h.01 M8 17h1 M12 17h1 M16 17h.01',
 packagingTree:'M9 2h6v5H9z M2 16h6v6H2z M16 16h6v6h-6z M12 7v5 M5 16v-4h14v4',
 grade:'M10 2h4v4h-4z M3 18h4v4H3z M17 18h4v4h-4z M12 6v6 M5 18v-6h14v6',
 history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
 price:'M3 3h8l10 10-8 8L3 11z M7 7h.01',
 sort:'M4 5h16 M4 12h11 M4 19h6 m9-7 0 9 m-3-3 3 3 3-3',
 edit:'m16 3 5 5-12 12-6 1 1-6z M14 5l5 5',
 layout:'M3 4h18v16H3z M9 4v16 M15 4v16',
 export:'M12 3v12 m-4-4 4 4 4-4 M4 16v5h16v-5',
 refresh:'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 2 M4 17l2 2a7 7 0 0 0 12-2',
 moon:'M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11',
 menu:'M4 6h16 M4 12h16 M4 18h16',
 save:'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-8h8v8',
 opportunity:'M4 20V10h4v10 M10 20V5h4v15 M16 20V2h4v18',
 package:'m3 7 9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10 M8 4l9 5',
 customer:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-3a4 4 0 0 0-3-4',
 left:'m14 6-6 6 6 6',right:'m10 6 6 6-6 6',
 up:'m6 14 6-6 6 6',down:'m6 10 6 6 6-6',plus:'M12 4v16 M4 12h16',close:'m6 6 12 12 M6 18 18 6'
};
export type IconName=keyof typeof paths;
export function Icon({name}:{name:IconName}){return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>}
export function IconButton({icon,label,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{icon:IconName;label:string}){return <button type="button" className="icon-button" title={label} aria-label={label} {...props}><Icon name={icon}/></button>}
