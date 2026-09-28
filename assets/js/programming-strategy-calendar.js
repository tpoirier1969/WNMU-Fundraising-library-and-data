'use strict';

(() => {
  const entries = [
    {
      date:'2026-12-05', endDate:'2026-12-12', time:'Sundown Dec. 4–nightfall Dec. 12',
      scope:'Holiday', kind:'observance', impact:'context',
      title:'Hanukkah',
      detail:'Jewish Festival of Lights, observed for eight nights. Evening observance begins at sundown.',
      sourceLabel:'Hebcal', sourceUrl:'https://www.hebcal.com/holidays/chanukah-2026'
    },
    {
      date:'2026-12-05', time:'6:07 PM ET',
      scope:'Regional', kind:'event', impact:'medium',
      title:'NMU at Michigan Tech hockey',
      detail:'Upper Peninsula rivalry game in Houghton. Likely regional audience competition into Saturday evening.',
      sourceLabel:'NMU Athletics', sourceUrl:'https://nmuwildcats.com/sports/mens-ice-hockey/schedule'
    },
    {
      date:'2026-12-05', time:'7:30 PM ET',
      scope:'Local', kind:'event', impact:'medium',
      title:'Marquette Choral Society holiday concert',
      detail:'One Message, Many Voices at Reynolds Recital Hall. Direct local arts-audience competition.',
      sourceLabel:'Marquette Choral Society', sourceUrl:'https://www.marquettechoralsociety.org/news-1/one-message-many-voices'
    },
    {
      date:'2026-12-05', time:'8:00 PM ET',
      scope:'National / regional', kind:'event', impact:'high',
      title:'Big Ten Football Championship',
      detail:'Prime-time FOX championship game. Major Saturday-night television competition, especially if a high-interest regional team qualifies.',
      sourceLabel:'Big Ten Conference', sourceUrl:'https://bigten.org/news/2026/9/24/2026-discover-big-ten-football-championship-game-ticket-information.aspx'
    },
    {
      date:'2026-12-06', time:'1:00 PM ET',
      scope:'Regional TV', kind:'event', impact:'medium',
      title:'Lions and Packers both play at 1 PM',
      detail:'Detroit at Atlanta on CBS and Green Bay at New Orleans on FOX. Strong Sunday-afternoon sports competition.',
      sourceLabel:'NFL schedules', sourceUrl:'https://www.detroitlions.com/news/lions-announce-2026-schedule'
    },
    {
      date:'2026-12-06', time:'3:00 PM ET',
      scope:'Local', kind:'event', impact:'low',
      title:'Marquette Choral Society holiday concert',
      detail:'Sunday matinee at Reynolds Recital Hall. Local arts competition, primarily affecting afternoon viewing.',
      sourceLabel:'Marquette Choral Society', sourceUrl:'https://www.marquettechoralsociety.org/news-1/one-message-many-voices'
    },
    {
      date:'2026-12-08', time:'All day; Mass times vary',
      scope:'Holiday', kind:'observance', impact:'context',
      title:'Immaculate Conception',
      detail:'Catholic holy day of obligation in the United States. Evening Mass schedules may affect some viewers.',
      sourceLabel:'USCCB', sourceUrl:'https://www.usccb.org/prayer-and-worship/liturgical-year/advent/advent-december-8'
    },
    {
      date:'2026-12-11', time:'7:07 PM ET',
      scope:'Local', kind:'event', impact:'medium',
      title:'NMU vs. Augustana hockey',
      detail:'Home hockey at the Berry Events Center. Direct local event competition on Friday evening.',
      sourceLabel:'NMU Athletics', sourceUrl:'https://nmuwildcats.com/sports/mens-ice-hockey/schedule'
    },
    {
      date:'2026-12-12', time:'6:07 PM ET',
      scope:'Local', kind:'event', impact:'medium',
      title:'NMU vs. Augustana hockey',
      detail:'Home hockey at the Berry Events Center. Direct local event competition into Saturday prime time.',
      sourceLabel:'NMU Athletics', sourceUrl:'https://nmuwildcats.com/sports/mens-ice-hockey/schedule'
    },
    {
      date:'2026-12-12', time:'7:30 PM ET',
      scope:'Local', kind:'event', impact:'medium',
      title:'Marquette Symphony holiday concert',
      detail:'Festive Favorites for the Season at Kaufman Auditorium. Strong overlap with the local public-media arts audience.',
      sourceLabel:'Marquette Symphony Orchestra', sourceUrl:'https://www.marquettesymphony.org/2026-27-calendar'
    },
    {
      date:'2026-12-13', time:'1:00 PM ET',
      scope:'Regional TV', kind:'event', impact:'medium',
      title:'Detroit Lions vs. Tennessee Titans',
      detail:'FOX regional NFL game. Primarily a Sunday-afternoon competitor.',
      sourceLabel:'Detroit Lions', sourceUrl:'https://www.detroitlions.com/news/lions-announce-2026-schedule'
    },
    {
      date:'2026-12-13', time:'2:00 PM ET',
      scope:'Local', kind:'event', impact:'low',
      title:'Marquette Symphony holiday concert',
      detail:'Sunday matinee at Kaufman Auditorium. Local arts competition during the afternoon.',
      sourceLabel:'Marquette Symphony Orchestra', sourceUrl:'https://www.marquettesymphony.org/2026-27-calendar'
    },
    {
      date:'2026-12-13', time:'8:20 PM ET',
      scope:'Regional TV', kind:'event', impact:'high',
      title:'Buffalo Bills at Green Bay Packers',
      detail:'NBC Sunday Night Football at Lambeau Field. Major Upper Midwest prime-time audience competition.',
      sourceLabel:'Green Bay Packers', sourceUrl:'https://www.packers.com/schedule/2026-opponents'
    }
  ];

  const asDate=(value)=>new Date(String(value||'')+'T12:00:00');
  const inRange=(entry,start,end)=>{
    const a=asDate(entry.date), b=asDate(entry.endDate||entry.date);
    return !Number.isNaN(a.getTime())&&!Number.isNaN(b.getTime())&&a<=end&&b>=start;
  };
  function forSchedule(schedule={}){
    const start=asDate(schedule.startDate), end=asDate(schedule.endDate);
    if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime()))return[];
    return entries.filter(entry=>inRange(entry,start,end)).map(entry=>({...entry}));
  }

  globalThis.WNMUStrategyCalendar={entries,forSchedule};
})();
