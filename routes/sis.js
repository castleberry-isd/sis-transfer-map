const express = require('express');
const { getDb } = require('../db/database');

let odbc;
function getOdbc() {
  if (!odbc) odbc = require('odbc');
  return odbc;
}

const router = express.Router();

const CONNECTION_STRING = process.env.SIS_ODBC_CONNECTION_STRING;

const SIS_QUERY = `
SELECT
      s."OTHER-ID"                                 AS other_id,
      se."STUDENT-STATUS"                          AS student_status,
      CASE WHEN se."STUDENT-CY-MEMBER" = 1
           THEN 'Cur' ELSE 'Pre' END              AS cur_or_pre,
      s."GRAD-YR"                                  AS grad_year,
      n."LAST-NAME"                                AS last_name,
      n."FIRST-NAME"                               AS first_name,
      CASE WHEN LTRIM(RTRIM(addr."STREET-NUMBER")) <> ''
           THEN LTRIM(RTRIM(addr."STREET-NUMBER"))
             || ' ' || LTRIM(RTRIM(addr."STREET-NAME"))
             || CASE WHEN LTRIM(RTRIM(addr."STREET-APPT")) <> ''
                     THEN ' ' || LTRIM(RTRIM(addr."STREET-APPT"))
                     ELSE '' END
           ELSE '' END                             AS address,
      LTRIM(RTRIM(z."ZIP-CITY"))                   AS city,
      LTRIM(RTRIM(z."ZIP-STATE"))                  AS state,
      LTRIM(RTRIM(addr."ZIP-CODE"))                AS zip,
      CASE WHEN LTRIM(RTRIM(addr."STREET-NUMBER")) <> ''
           THEN LTRIM(RTRIM(addr."STREET-NUMBER"))
             || ' ' || LTRIM(RTRIM(addr."STREET-NAME"))
             || CASE WHEN LTRIM(RTRIM(addr."STREET-APPT")) <> ''
                     THEN ' ' || LTRIM(RTRIM(addr."STREET-APPT"))
                     ELSE '' END
             || CASE WHEN LTRIM(RTRIM(z."ZIP-CITY")) <> ''
                     THEN ', ' || LTRIM(RTRIM(z."ZIP-CITY"))
                     ELSE '' END
             || CASE WHEN LTRIM(RTRIM(z."ZIP-STATE")) <> ''
                     THEN ', ' || LTRIM(RTRIM(z."ZIP-STATE"))
                     ELSE '' END
             || CASE WHEN LTRIM(RTRIM(addr."ZIP-CODE")) <> ''
                     THEN ' ' || LTRIM(RTRIM(addr."ZIP-CODE"))
                     ELSE '' END
           ELSE '' END                             AS single_line_address,
      gn."FIRST-NAME" || ' ' ||
        gn."LAST-NAME"                            AS guardian_name,
      gn."INTERNET-ADDRESS"                        AS guardian_email,
      gn."PRIMARY-PHONE"                           AS guardian_phone,
      CASE
          WHEN 12 - (s."GRAD-YR" - 2026) < 0  THEN 'PK'
          WHEN 12 - (s."GRAD-YR" - 2026) = 0  THEN 'KG'
          ELSE CAST(12 - (s."GRAD-YR" - 2026) AS VARCHAR(2))
      END                                          AS student_grade,
      sch."SCHOOL-NAME"                            AS campus,
      ew."DISTRICT-CODE"                           AS res_district,
      d."DISTRICT-NAME"                            AS res_dist_desc,
      addr."GEOCODE"                               AS arcgis_display,
      ew."ENTRYC-CODE"                             AS entry_code,
      ec."ENTRYC-LDESC"                            AS entry_desc,
      sx."SPEC-ED"                                 AS spec_ed_status,
      sx."PRI-DISABILITY"                          AS pri_dis_code,
      CASE sx."PRI-DISABILITY"
          WHEN '01' THEN 'Intellectual Disability'
          WHEN '02' THEN 'Orthopedic Impairment'
          WHEN '03' THEN 'Other Health Impairment'
          WHEN '04' THEN 'Auditory Impairment'
          WHEN '05' THEN 'Visual Impairment'
          WHEN '06' THEN 'Emotional Disturbance'
          WHEN '07' THEN 'Learning Disability'
          WHEN '08' THEN 'Speech Impairment'
          WHEN '09' THEN 'Autism'
          WHEN '10' THEN 'Developmental Delay'
          WHEN '12' THEN 'Deaf-Blind'
          WHEN '13' THEN 'Traumatic Brain Injury'
          WHEN '14' THEN 'Noncategorical Early Childhood'
          ELSE '' END                              AS pri_dis_desc,
      tn."FIRST-NAME" || ' ' ||
        tn."LAST-NAME"                            AS homeroom_tchr,
      se."HOMEROOM-NUMBER"                         AS homeroom_number,
      CASE
          WHEN n."ETHNICITY-HISP-X" = 1
              THEN 'Hispanic/Latino'
          WHEN SUBSTRING(n."FED-RACE-FLAGS",1,1) = '1'
           AND SUBSTRING(n."FED-RACE-FLAGS",2,4) = '0000'
              THEN 'American Indian or Alaska Native'
          WHEN SUBSTRING(n."FED-RACE-FLAGS",2,1) = '1'
           AND SUBSTRING(n."FED-RACE-FLAGS",1,1) = '0'
           AND SUBSTRING(n."FED-RACE-FLAGS",3,3) = '000'
              THEN 'Asian'
          WHEN SUBSTRING(n."FED-RACE-FLAGS",3,1) = '1'
           AND SUBSTRING(n."FED-RACE-FLAGS",1,2) = '00'
           AND SUBSTRING(n."FED-RACE-FLAGS",4,2) = '00'
              THEN 'Black or African American'
          WHEN SUBSTRING(n."FED-RACE-FLAGS",4,1) = '1'
           AND SUBSTRING(n."FED-RACE-FLAGS",1,3) = '000'
           AND SUBSTRING(n."FED-RACE-FLAGS",5,1) = '0'
              THEN 'Native Hawaiian or Other Pacific Islander'
          WHEN SUBSTRING(n."FED-RACE-FLAGS",5,1) = '1'
           AND SUBSTRING(n."FED-RACE-FLAGS",1,4) = '0000'
              THEN 'White'
          ELSE 'Two or More Races'
      END                                          AS eth_race_desc,
      CASE WHEN SUBSTRING(n."FED-RACE-FLAGS",5,1) = '1'
           THEN 'Y' ELSE 'N' END                  AS white,
      n."GENDER"                                   AS gender,
      CASE WHEN n."ETHNICITY-HISP-X" = 1
           THEN 'Y' ELSE 'N' END                  AS hisp_lat_eth
  FROM SKYWARD.PUB.STUDENT s
  JOIN SKYWARD.PUB.NAME n
    ON n."NAME-ID" = s."NAME-ID"
  JOIN SKYWARD.PUB."STUDENT-ENTITY" se
    ON se."STUDENT-ID" = s."STUDENT-ID"
  JOIN SKYWARD.PUB.SCHOOL sch
    ON sch."SCHOOL-ID" = se."SCHOOL-ID"
  LEFT JOIN SKYWARD.PUB.ADDRESS addr
    ON addr."ADDRESS-ID" = n."ADDRESS-ID"
  LEFT JOIN SKYWARD.PUB.ZIP z
    ON z."ZIP-CODE" = addr."ZIP-CODE"
  LEFT JOIN SKYWARD.PUB."STUDENT-EXT" sx
    ON sx."STUDENT-ID" = s."STUDENT-ID"
  LEFT JOIN SKYWARD.PUB."STUDENT-EW" ew
    ON ew."STUDENT-ID" = s."STUDENT-ID"
   AND ew."ENTITY-ID" = se."ENTITY-ID"
   AND ew."WITHDRAWAL-CODE" = ''
   AND ew."EW-DATE" = (
      SELECT MAX(ew2."EW-DATE")
      FROM SKYWARD.PUB."STUDENT-EW" ew2
      WHERE ew2."STUDENT-ID" = ew."STUDENT-ID"
        AND ew2."ENTITY-ID" = ew."ENTITY-ID"
        AND ew2."WITHDRAWAL-CODE" = ''
    )
  LEFT JOIN SKYWARD.PUB.ENTRYC ec
    ON ec."ENTRYC-CODE" = ew."ENTRYC-CODE"
  LEFT JOIN SKYWARD.PUB.DISTRICT d
    ON d."DISTRICT-CODE" = ew."DISTRICT-CODE"
  LEFT JOIN SKYWARD.PUB."STUDENT-GUARDIAN" sg
    ON sg."STUDENT-ID" = s."STUDENT-ID"
   AND sg."CUST-PAR" = 1
   AND sg."NAME-ID" = (
      SELECT MIN(sg2."NAME-ID")
      FROM SKYWARD.PUB."STUDENT-GUARDIAN" sg2
      WHERE sg2."STUDENT-ID" = s."STUDENT-ID"
        AND sg2."CUST-PAR" = 1
    )
  LEFT JOIN SKYWARD.PUB.NAME gn
    ON gn."NAME-ID" = sg."NAME-ID"
  LEFT JOIN SKYWARD.PUB.NAME tn
    ON tn."NAME-ID" = se."ADVISOR"
   AND se."ADVISOR" > 0
  WHERE se."STUDENT-STATUS" = 'A'
  ORDER BY sch."SCHOOL-NAME", n."LAST-NAME", n."FIRST-NAME"
`;

// Sync active students from Skyward SIS via ODBC (SSE endpoint)
router.get('/sync', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let connection;
  try {
    if (!CONNECTION_STRING) {
      send({ error: 'SIS_ODBC_CONNECTION_STRING not configured. Set it in your .env file.' });
      res.end();
      return;
    }
    send({ step: 'connecting', message: 'Connecting to Skyward SIS...' });
    connection = await getOdbc().connect(CONNECTION_STRING);

    send({ step: 'querying', message: 'Querying active students...' });
    const rows = await connection.query(SIS_QUERY);

    const normalizedRows = rows.map(row => {
      const obj = {};
      for (const [key, val] of Object.entries(row)) {
        obj[key.toLowerCase()] = val;
      }
      return obj;
    });

    send({ step: 'importing', message: `Retrieved ${normalizedRows.length} students. Importing...` });

    const db = getDb();

    const upsertStmt = db.prepare(`
      INSERT INTO students (student_id, first_name, last_name, address, enrollment_status, entry_code,
        grad_year, student_grade, campus, guardian_name, guardian_email, guardian_phone,
        res_district, res_dist_desc, entry_desc, spec_ed_status, pri_dis_code, pri_dis_desc,
        homeroom_tchr, homeroom_number, eth_race_desc, gender, arcgis_display)
      VALUES (?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?)
      ON CONFLICT(student_id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        address = excluded.address,
        enrollment_status = excluded.enrollment_status,
        entry_code = excluded.entry_code,
        grad_year = excluded.grad_year,
        student_grade = excluded.student_grade,
        campus = excluded.campus,
        guardian_name = excluded.guardian_name,
        guardian_email = excluded.guardian_email,
        guardian_phone = excluded.guardian_phone,
        res_district = excluded.res_district,
        res_dist_desc = excluded.res_dist_desc,
        entry_desc = excluded.entry_desc,
        spec_ed_status = excluded.spec_ed_status,
        pri_dis_code = excluded.pri_dis_code,
        pri_dis_desc = excluded.pri_dis_desc,
        homeroom_tchr = excluded.homeroom_tchr,
        homeroom_number = excluded.homeroom_number,
        eth_race_desc = excluded.eth_race_desc,
        gender = excluded.gender,
        arcgis_display = excluded.arcgis_display
    `);

    let imported = 0;
    let skipped = 0;

    const importAll = db.transaction(() => {
      for (const row of normalizedRows) {
        const studentId = (row.other_id || '').toString().trim();
        const firstName = (row.first_name || '').trim();
        const lastName = (row.last_name || '').trim();
        const address = (row.single_line_address || row.address || '').trim();

        if (!firstName || !lastName || !address) {
          skipped++;
          continue;
        }

        upsertStmt.run(
          studentId || null,
          firstName,
          lastName,
          address,
          'existing',
          (row.entry_code || '').toString().trim() || null,
          (row.grad_year || '').toString().trim() || null,
          (row.student_grade || '').toString().trim() || null,
          (row.campus || '').toString().trim() || null,
          (row.guardian_name || '').toString().trim() || null,
          (row.guardian_email || '').toString().trim() || null,
          (row.guardian_phone || '').toString().trim() || null,
          (row.res_district || '').toString().trim() || null,
          (row.res_dist_desc || '').toString().trim() || null,
          (row.entry_desc || '').toString().trim() || null,
          (row.spec_ed_status || '').toString().trim() || null,
          (row.pri_dis_code || '').toString().trim() || null,
          (row.pri_dis_desc || '').toString().trim() || null,
          (row.homeroom_tchr || '').toString().trim() || null,
          (row.homeroom_number || '').toString().trim() || null,
          (row.eth_race_desc || '').toString().trim() || null,
          (row.gender || '').toString().trim() || null,
          (row.arcgis_display || '').toString().trim() || null
        );
        imported++;
      }
    });

    importAll();

    const sisIds = normalizedRows.map(r => (r.other_id || '').toString().trim()).filter(Boolean);
    if (sisIds.length > 0) {
      const allDbStudents = db.prepare('SELECT id, student_id FROM students WHERE student_id IS NOT NULL').all();
      const sisIdSet = new Set(sisIds);
      let removed = 0;
      const deleteStmt = db.prepare('DELETE FROM students WHERE id = ?');
      const removeWithdrawn = db.transaction(() => {
        for (const s of allDbStudents) {
          if (!sisIdSet.has(s.student_id)) {
            deleteStmt.run(s.id);
            removed++;
          }
        }
      });
      removeWithdrawn();

      if (removed > 0) {
        send({ step: 'cleanup', message: `Removed ${removed} withdrawn students` });
      }
    }

    send({ step: 'done_import', imported, skipped, total: rows.length });
    send({ done: true, imported, skipped, total: rows.length });
  } catch (err) {
    console.error('SIS sync error:', err);
    send({ error: err.message || 'SIS connection failed' });
  } finally {
    if (connection) {
      try { await connection.close(); } catch {}
    }
    res.end();
  }
});

// Test ODBC connectivity
router.get('/test', async (req, res) => {
  if (!CONNECTION_STRING) {
    return res.status(500).json({ error: 'SIS_ODBC_CONNECTION_STRING not configured. Set it in your .env file.' });
  }
  let connection;
  try {
    connection = await getOdbc().connect(CONNECTION_STRING);
    const result = await connection.query('SELECT COUNT(*) AS cnt FROM SKYWARD.PUB.STUDENT');
    res.json({ success: true, studentCount: result[0]?.cnt });
  } catch (err) {
    console.error('SIS connection test error:', err);
    res.status(500).json({ error: err.message || 'Connection failed' });
  } finally {
    if (connection) {
      try { await connection.close(); } catch {}
    }
  }
});

module.exports = router;
