# MMS data map for the Person page

Read Nov 3, 2026 through the read-only MMS connection on Ben's Mac.

## Student record (`POST /v1/search/students` with `{"IDs": [...]}`)

| Field | Use on the Person page |
|---|---|
| `ID` (`sdt_...`) | Key. Links to Sequencer rows and to the MMS record URL `https://app.mymusicstaff.com/Teacher/v2/en/students/details?id=<ID>` |
| `FirstName`, `LastName`, `FullName` | Header |
| `Status` | Pill: `Lead`, `Trial`, `Waiting`, `Active`, `Inactive` |
| `Email.EmailAddress` | Join key to Sequencer Enrollments and Gmail threads |
| `Telephone.TelephoneNumber`, `TextingAllowed` | Contact, and the future texting opt-in |
| `DateStarted` | "Since" date |
| `LastEventDate`, `NextEventDate` | Last and next lesson or rehearsal; drives the "gone quiet" flag |
| `Note` | Sign-up form answers (instrument, level, interests, source). Shown as the first timeline entry |
| `FamilyID`, `AdultStudentParentID` | Billing lives on the family; needed for convert and offboard, not for display |
| `ProfileThumbnailURL` | Avatar when `HasProfilePicture` is true |

`StudentGroups` and `Tags` come back null on search. Read tags separately.

## Tags (student groups): `mms_tags`

68 tags, all type Group. They carry three kinds of facts:

- **Program:** `Group 1` to `Group 21`, `Vocal Ensemble`, cohort tags like `Foundations 1 - Nov 2026`, `JSP - Jan 2027`, `Jam Session Skills - Nov 2026`.
- **Instrument:** `Plays: Bass`, `Plays: Drums`, `Plays: Sax`, `Plays: Piano/Keys`, `Plays: Voice` and so on (13).
- **Role or state:** `Ensemble Member`, `Former Ensemble Member`, `Private Lessons - Active`, `Scholarship Rate`, teacher tags.

Tag membership must be read with `POST /v1/search/students` and `{"StudentGroupIDs": [id]}`, one tag at a time. `GET /v1/students/?IncludeStudentGroups=true` returns `StudentGroups: null` (tested Nov 3), and `studentgroups` returns `StudentIDs: null`; only `StudentCount` there is reliable. `SkillLevel` on the student is a numeric skill rating (for example "5.5"), filled in for about 80 students.

## Not in MMS, so it lives in the Sequencer Sheet

Belt level, interests beyond the sign-up note, next step and owner, follow-up date, internal notes, sequence history. Keyed by MMS `ID`, with email as fallback for people not yet in MMS.

## Open decision before the backend can read MMS

The Person page's backend is the Sequencer Apps Script, which runs on Google, not on Ben's Mac. To read MMS it needs the MMS API key stored in the script's Script Properties (encrypted at rest, visible only to the script owner). Alternative: a scheduled sync on the Mac pushes the fields above into a hidden Sheet tab, and the script reads that. The first is live; the second keeps the key on the Mac.

## Lead funnel fields are MMS tags (Nov 2026)

The app keeps no table of leads. A lead's funnel fields are tags on the student in MMS:

| Field | Tag | Notes |
|---|---|---|
| Stage | `Stage: Qualified`, `Stage: Deposit Submitted`, `Stage: Nurture`, `Stage: Closed` | One at a time. No stage tag = New Lead (or Enrolled if MMS status is Active). An "(Ensemble Deposit)" form on the student note reads as Deposit Submitted until someone sets a stage. |
| Interested in | `Interest: Ensemble`, `Interest: Private lessons`, ... | Any number. Falls back to the sign-up form answers when none are set. |
| Nights | `Nights: Mon` ... `Nights: Sun` | Any number. |
| Plays | existing `Plays: ...` tags | Falls back to the form's Instrument answer. |

Writes go through `tagWrite_` in `backend/Leads.gs`: read members, check the count against
`StudentCount`, PUT the full list with one person added or removed, read back. A count mismatch
stops the write. Tags are created on first use. Next steps and notes stay in the Notes tab.
