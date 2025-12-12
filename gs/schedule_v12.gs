/*************************************************
 * 排班 1.1（單一濟時樓版）
 * - 使用工作表：slots / responses / stats / 濟時總表
 * - 不處理國璽、不分館別
 *************************************************/

/** 取得日期字串 yyyy-MM-dd（給 group key 用） */
function formatDateKey_(d) {
  const year  = d.getFullYear();
  const month = ('0' + (d.getMonth() + 1)).slice(-2);
  const day   = ('0' + d.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

/** 中文星期：週日～週六 */
function getChineseWeekday_(d) {
  const w = d.getDay();
  const arr = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return arr[w] || '';
}

/** 讀取 slots → 回傳 Map<slot_id, {date:Date, timeLabel:string}> */
function readSlotsMap_(library) {
  library = library || '濟時';
  const sheetName = getSheetName_('slots', library);
  const sheet = getSheet_(sheetName);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return new Map();

  const header = values[0];
  const idxSlotId = header.indexOf('slot_id');
  const idxDate   = header.indexOf('date');
  const idxTime   = header.indexOf('time_label');

  if (idxSlotId === -1 || idxDate === -1 || idxTime === -1) {
    throw new Error('slots 表缺少 slot_id / date / time_label 欄位');
  }

  const map = new Map();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const slotId = String(row[idxSlotId] || '').trim();
    if (!slotId) continue;

    const rawDate = row[idxDate];
    let dateObj;
    if (rawDate instanceof Date) {
      dateObj = rawDate;
    } else if (rawDate) {
      dateObj = new Date(rawDate);
    } else {
      continue;
    }

    const timeLabel = String(row[idxTime] || '').trim();
    map.set(slotId, { date: dateObj, timeLabel });
  }
  return map;
}

/** 讀取 stats → 陣列 {slotId, names} */
function readStatsList_(library) {
  library = library || '濟時';
  const sheetName = getSheetName_('stats', library);
  const sheet = getSheet_(sheetName);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const header    = values[0];
  const idxSlotId = header.indexOf('slot_id');
  const idxNames  = header.indexOf('names');

  if (idxSlotId === -1 || idxNames === -1) {
    throw new Error('stats 表缺少 slot_id / names 欄位');
  }

  const list = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const slotId = String(row[idxSlotId] || '').trim();
    if (!slotId) continue;
    const names = String(row[idxNames] || '').trim();
    list.push({ slotId, names });
  }
  return list;
}

/*************************************************
 * 純試算版：從 responses 重新計算 stats
 * - 支援雙館別
 *************************************************/
function recomputeStatsSimple(library) {
  library = library || '濟時';
  const slotsSheetName = getSheetName_('slots', library);
  const respSheetName  = getSheetName_('responses', library);
  const statsSheetName = getSheetName_('stats', library);

  const slotsSheet = getSheet_(slotsSheetName);
  const respSheet  = getSheet_(respSheetName);
  const statsSheet = getSheet_(statsSheetName);

  const slotValues = slotsSheet.getDataRange().getValues();
  const respValues = respSheet.getDataRange().getValues();

  if (slotValues.length < 2) {
    statsSheet.clear();
    statsSheet.appendRow(['slot_id', 'count', 'names']);
    return;
  }

  const slotHeader = slotValues[0];
  const idxSlotId  = slotHeader.indexOf('slot_id');
  if (idxSlotId === -1) {
    throw new Error('slots 表缺少 slot_id 欄位');
  }

  const slotIds = slotValues
    .slice(1)
    .map(r => String(r[idxSlotId] || '').trim())
    .filter(id => id);

  const statsMap = {};
  slotIds.forEach(id => {
    statsMap[id] = { count: 0, namesSet: {} };
  });

  if (respValues.length >= 2) {
    const respHeader = respValues[0];
    const idxName    = respHeader.indexOf('name');
    const idxSlots   = respHeader.indexOf('slots_str');

    if (idxName === -1 || idxSlots === -1) {
      throw new Error('responses 表缺少 name / slots_str 欄位');
    }

    for (let i = 1; i < respValues.length; i++) {
      const row  = respValues[i];
      const name = String(row[idxName] || '').trim();
      const sstr = String(row[idxSlots] || '').trim();
      if (!name || !sstr) continue;

      const ids = sstr.split(',').map(s => s.trim()).filter(Boolean);
      ids.forEach(id => {
        const info = statsMap[id];
        if (!info) return;
        if (!info.namesSet[name]) {
          info.namesSet[name] = true;
          info.count++;
        }
      });
    }
  }

  statsSheet.clear();
  statsSheet.appendRow(['slot_id', 'count', 'names']);

  const rows = slotIds.map(id => {
    const info  = statsMap[id] || { count: 0, namesSet: {} };
    const names = Object.keys(info.namesSet);
    return [id, info.count, names.join('、')];
  });

  if (rows.length > 0) {
    statsSheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

/*************************************************
 * 總表輸出（支援雙館別）
 * - 濟時樓：3 班別（A~G 欄）
 * - 國璽樓：8 班別（A~K 欄）
 *************************************************/
function renderJishiSummary(library) {
  library = library || '濟時';
  const slotsMap  = readSlotsMap_(library);
  const statsList = readStatsList_(library);

  const slotInfoMap = new Map(); // slotId → {date, timeLabel, names}

  for (const s of statsList) {
    const sid = String(s.slotId || '').trim();
    if (!sid) continue;

    const meta = slotsMap.get(sid);
    if (!meta) continue;

    slotInfoMap.set(sid, {
      date: meta.date,
      timeLabel: meta.timeLabel,
      names: s.names
    });
  }

  // 依日期 group
  const byDate = new Map(); // dateKey → { date, slots: [ {slotId, no, names} ] }
  for (const [slotId, info] of slotInfoMap.entries()) {
    const dateKey = formatDateKey_(info.date);

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { date: info.date, slots: [] });
    }

    let no = 0;
    const m = slotId.match(/_(\d+)$/);
    if (m) {
      no = parseInt(m[1], 10);
    }

    byDate.get(dateKey).slots.push({
      slotId,
      no,
      names: info.names
    });
  }

  // 依日期排序
  const dateEntries = Array.from(byDate.entries()).sort((a, b) => {
    return a[1].date - b[1].date;
  });

  const summarySheetName = library + '總表';
  const sheet = getSheet_(summarySheetName);

  // 根據館別決定欄位數
  const isGuoxi = (library === '國璽');
  const numCols = isGuoxi ? 11 : 7; // 國璽 11欄(A~K)，濟時 7欄(A~G)

  // 清空第 6 列以下舊資料
  const lastRow = sheet.getLastRow();
  if (lastRow >= 6) {
    sheet.getRange(6, 1, lastRow - 5, numCols).clearContent();
  }

  const rows = [];
  
  for (const [, group] of dateEntries) {
    const d       = group.date;
    const weekday = getChineseWeekday_(d);
    const slotSorted = group.slots.slice().sort((a, b) => a.no - b.no);

    if (isGuoxi) {
      // 國璽樓：8 個班別
      let colC = '', colD = '', colE = '', colF = '';
      let colG = '', colH = '', colI = '', colJ = '';
      
      if (slotSorted[0]) colC = slotSorted[0].names || ''; // 早1 (平日3樓早午)
      if (slotSorted[1]) colD = slotSorted[1].names || ''; // 早2 (平日3樓早午)
      if (slotSorted[2]) colE = slotSorted[2].names || ''; // 午1 (平日3樓早午)
      if (slotSorted[3]) colF = slotSorted[3].names || ''; // 午2 (平日3樓早午)
      if (slotSorted[4]) colG = slotSorted[4].names || ''; // 早1 (館日5樓3班)
      if (slotSorted[5]) colH = slotSorted[5].names || ''; // 午1 (館日5樓3班)
      if (slotSorted[6]) colI = slotSorted[6].names || ''; // 晩1 (3樓&5樓)
      if (slotSorted[7]) colJ = slotSorted[7].names || ''; // 晩2 (晚間5樓)
      
      const colK = ''; // 備註
      
      rows.push([
        d,        // A：日期
        weekday,  // B：星期
        colC,     // C：早1
        colD,     // D：早2
        colE,     // E：午1
        colF,     // F：午2
        colG,     // G：早1
        colH,     // H：午1
        colI,     // I：晩1
        colJ,     // J：晩2
        colK      // K：備註
      ]);
    } else {
      // 濟時樓：3 個班別
      let colC = '', colD = '', colE = '';
      
      if (slotSorted[0]) colC = slotSorted[0].names || ''; // 早1
      if (slotSorted[1]) colD = slotSorted[1].names || ''; // 午2
      if (slotSorted[2]) colE = slotSorted[2].names || ''; // 午1
      
      const colF = ''; // 特休
      const colG = ''; // 備註
      
      rows.push([
        d,        // A：日期
        weekday,  // B：星期
        colC,     // C：早1
        colD,     // D：午2
        colE,     // E：午1
        colF,     // F：特休
        colG      // G：備註
      ]);
    }
  }

  if (rows.length > 0) {
    sheet.getRange(6, 1, rows.length, numCols).setValues(rows);
  }
}

/*************************************************
 * 一鍵更新排班總表
 *************************************************/
function updateJishiSummaryAll(library) {
  library = library || '濟時';
  recomputeStatsSimple(library);
  renderJishiSummary(library);
}

// 為兩個館別建立獨立的函數
function updateJishiSummaryAllJishi() {
  updateJishiSummaryAll('濟時');
}

function updateJishiSummaryAllGuoxi() {
  updateJishiSummaryAll('國璽');
}

/*************************************************
 * 只重畫總表（不重算 stats）
 *************************************************/
function redrawJishiSummaryOnly(library) {
  library = library || '濟時';
  renderJishiSummary(library);
}

function redrawJishiSummaryOnlyJishi() {
  redrawJishiSummaryOnly('濟時');
}

function redrawJishiSummaryOnlyGuoxi() {
  redrawJishiSummaryOnly('國璽');
}
