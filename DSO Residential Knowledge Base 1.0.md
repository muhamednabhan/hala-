# Dubai Silicon Oasis (DSO) — Residential Services & Community Knowledge Base

## 0. Residential Scope, Routing Rules & Escalation Guardrails
- **Target Audience:** Residents and prospective tenants living in DSO-managed residential communities (including **Cedre Villas**, **Semmer Villas**, **Palace Towers**, and **Axis Residences**) as well as visitors to the DSO residential district.
- **AI Disclosure & Demo Data Rule:** Always disclose early that you are an AI voice assistant, and explicitly state when any fee, deposit, or SLA timeline is **[DEMO DATA]** (Arabic: *بيانات تجريبية*).
- **Residential Action Routing (STOP OVER-BOOKING RULE):**
  - **Maintenance Requests:** Dispatch a technician (`book_appointment` with `service_type: "Maintenance Dispatch"`)—do **not** book an office meeting.
  - **Maintenance Follow-Ups:** Check/update existing ticket (`manage_booking` with `action: "check_status"`).
  - **Access Cards & RFID Parking Tags:** Self-service via `eservices.dso.ae` with **reception pickup in a few minutes or courier delivery**—**NO appointment needed**.
  - **Leasing & Move-In/Move-Out:** Offer a viewing or contract-signing slot (`book_appointment`) only if requested.
  - **Community Amenities & Transport:** Answer directly and concisely from Section 5—no booking needed.
  - **Fee Disputes, Billing & Security Emergencies:** Immediate human handover (`escalate_to_human`) to DSO Customer Happiness (**600 59 55 57**, Mon–Fri 08:00–15:00) or **hello@dso.ae**.

---

## 1. Residential Procedures (High-Level Operational Workflows)

### Procedure R1: New Maintenance Request & Technician Dispatch
- **Trigger:** Resident reports an AC/cooling issue, water leak/plumbing fault, electrical outage, appliance issue (in DSO-furnished units), or common-area lift/lighting fault.
- **Action Path:** Collect details $\rightarrow$ Log technician visit (`book_appointment`) $\rightarrow$ Offer SMS/email confirmation (`send_followup_summary`).
- **Steps:**
  1. Ask for: **Building/Villa Community Name**, **Apartment or Villa Number**, **Issue Category** (AC, Plumbing, Electrical, Civil/Common Area), and **Urgency** (Emergency vs. Routine).
  2. Share the SLA and cost clearly labeled as **demo data**:
     - *Emergency (active water leak, total AC failure, power outage):* Technician dispatched within **2 hours [DEMO DATA]**.
     - *Routine (minor repair, fixture replacement, paint/civil):* Technician dispatched within **24 hours [DEMO DATA]**.
     - *Cost:* **AED 0 (Free) [DEMO DATA]** for standard covered building/community maintenance (tenant-caused damage or private upgrades are quoted separately).
  3. Collect **Full Name**, **Preferred Date/Window**, and **Mobile Number**, call `book_appointment`, and read back the **Ticket Reference ID**.

### Procedure R2: Maintenance Request Follow-Up & Rescheduling
- **Trigger:** Resident asks for a status update on an open maintenance ticket or needs to change the technician arrival time.
- **Action Path:** Check/update ticket (`manage_booking`) $\rightarrow$ Escalate only if overdue/angry (`escalate_to_human`).
- **Steps:**
  1. Ask for their **Ticket / Booking Reference Number** (or Full Name + Unit Number).
  2. Call `manage_booking` (`action: "check_status"` or `"reschedule"`).
  3. Confirm the technician status or new arrival window out loud. If a ticket has missed its SLA and the resident is upset, apologize calmly and hand over to a human officer (`escalate_to_human`).

### Procedure R3: Residential Leasing, Renewals & Move-In / Move-Out Permits
- **Trigger:** Caller asks to rent a villa/apartment, renew a residential lease, terminate early, or obtain a Move-In / Move-Out security permit.
- **Action Path:** Inform $\rightarrow$ Direct to `eservices.dso.ae` or offer a Leasing Viewing/Signing Slot (`book_appointment`).
- **Steps:**
  1. Share DSO-managed residential options: **Cedre Villas**, **Semmer Villas**, **Palace Towers**, and **Axis Residences**.
  2. Summarize required documents concisely: Passport copy, valid UAE Residence Visa, Emirates ID, security deposit cheque (**5% of annual rent [DEMO DATA]**), and Ejari fee (**AED 550 [DEMO DATA]**).
  3. For **Move-In / Move-Out Permits**, explain they are requested on `eservices.dso.ae` at least **48 hours in advance [DEMO DATA]** with a valid Ejari/lease copy and clearance of any community dues (**AED 0 permit fee [DEMO DATA]**).
  4. Ask once if they would like to book a property viewing or leasing desk appointment (`book_appointment`).

### Procedure R4: Resident Access Cards & RFID Parking Tags (NO Appointment)
- **Trigger:** Resident needs a building/community access card, villa gate RFID tag, or replacement for a lost/damaged card.
- **Action Path:** Inform $\rightarrow$ Reception Pickup or Courier Delivery (NO booking tool).
- **Steps:**
  1. List required documents: Emirates ID/Passport copy, valid DSO Residential Tenancy Contract (Ejari), and Vehicle Registration Card (**Mulkiya**) if linking underground/villa barrier parking.
  2. State the demo fee: **AED 150** for a new card/tag or **AED 200** for a lost/damaged replacement **[DEMO DATA]**.
  3. Explain that **no appointment is required**: submit on `eservices.dso.ae` and either **pick up at DSO HQ HALA Reception within a few minutes** or choose **courier delivery**.
  4. **Fee Dispute Rule:** If the resident disputes the AED 200 replacement fee (e.g., claiming the card stopped scanning on its own), immediately execute `escalate_to_human` (**Procedure G**).

### Procedure R5: Community Complaints, Parking Violations & Noise Disturbances
- **Trigger:** Resident reports unauthorized parking in their reserved bay, loud noise, pet/common-area violations, or a billing complaint.
- **Action Path:** Log complaint ticket (`send_followup_summary`) OR immediate human handover (`escalate_to_human`).
- **Steps:**
  1. Stay calm and empathetic.
  2. For **unauthorized parking** blocking a reserved bay, capture the building/basement level and vehicle plate number, log the alert for DSO Community Security (**response within 30 minutes [DEMO DATA]**), and send a confirmation reference via `send_followup_summary`.
  3. For **billing/deposit disputes** or an **angry/impatient caller**, immediately call `escalate_to_human` and provide **600 59 55 57** (Mon–Fri 08:00–15:00) or **hello@dso.ae**.

---

## 2. Residential Frequently Asked Questions (FAQs)

### Category A: Maintenance & Facilities Management (FM)
- **Q1: How quickly will a technician arrive if my AC breaks down or a pipe leaks?**
  - **A:** Emergency issues—such as active water leaks, total air-conditioning failure, or electrical power outages—are dispatched within **2 hours [DEMO DATA]**. Routine maintenance requests are scheduled within **24 hours [DEMO DATA]**.
- **Q2: Do I have to pay for residential maintenance visits in DSO?**
  - **A:** Standard building and community maintenance for DSO-managed residences is **free (AED 0) [DEMO DATA]**, as it is covered under your lease/service agreement. However, repairs caused by tenant misuse or private appliance installations may incur a separate quote **[DEMO DATA]**.
- **Q3: How do I follow up on a maintenance ticket I already submitted?**
  - **A:** Just share your ticket reference number (or your name and unit number) right here, and I can check its live status or reschedule your technician window immediately. You can also track it on `eservices.dso.ae`.

### Category B: Leasing, Ejari & Move-In / Move-Out
- **Q4: Which residential communities are managed by DSO?**
  - **A:** DSO directly manages **Cedre Villas**, **Semmer Villas**, **Palace Towers**, and **Axis Residences**, alongside commercial/mixed-use residences in Dubai Digital Park.
- **Q5: What documents do I need to rent or renew an apartment/villa in DSO?**
  - **A:** You need your **passport copy**, **valid UAE Residence Visa**, **Emirates ID**, a **security deposit cheque (5% of annual rent [DEMO DATA])**, and the **lease admin & Ejari fee of AED 550 [DEMO DATA]**. Renewals can be completed digitally on `eservices.dso.ae`.
- **Q6: Do I need a permit to move furniture in or out of my DSO building or villa?**
  - **A:** Yes. Submit a **Move-In / Move-Out Permit** request on `eservices.dso.ae` at least **48 hours before your moving date [DEMO DATA]** along with your signed lease/Ejari. The permit fee is **AED 0 [DEMO DATA]**, though a refundable common-area moving deposit of **AED 1,000 [DEMO DATA]** may apply for apartment towers.

### Category C: Access Cards & Parking
- **Q7: I lost my residential access card or parking RFID tag. How do I get a new one, and do I need an appointment?**
  - **A:** **No appointment is needed.** Submit a replacement request on `eservices.dso.ae` with your Emirates ID and tenancy contract (plus your Mulkiya for parking access). The replacement fee is **AED 200 [DEMO DATA]**, and you can either **pick it up within a few minutes at DSO HQ reception** or have it **delivered by courier**.
- **Q8: What if my access card stopped working on its own without any physical damage?**
  - **A:** If a newly issued card has a technical defect within **30 days**, replacement at reception is **free (AED 0) [DEMO DATA]** upon inspection. If you were charged AED 200 and wish to dispute the fee, I can connect you directly to a human DSO Customer Happiness officer.

### Category D: Community Amenities, Shopping, Healthcare & Transport (Verified Local Facts)
- **Q9: Where can I buy groceries or find a 24-hour pharmacy in DSO?**
  - **A:** **Union Coop Silicon Oasis**, **Souq Extra**, and **Life Pharmacy in Palace Towers** are all open **24 hours**. **Silicon Central Mall** is open daily from **08:00 to 00:00** (midnight) and includes Friends Avenue Cafe on the ground floor and Emirates NBD on the first floor.
- **Q10: Where are the nearest medical clinics and what are their hours?**
  - **A:** Both **Burjeel Medical Center DSO** and **Life Medical Centre** are open daily from **07:00 to 23:00**.
- **Q11: Where are the mosques in DSO and are there parking facilities?**
  - **A:** **DSO Masjid** is located in the **Techno Point building** and offers free parking. **Al Waha Masjid** is open daily from **04:00 to 23:00**.
- **Q12: Which public buses serve Dubai Silicon Oasis?**
  - **A:** DSO is served by RTA bus routes **50, 320, 365, 366, and X25**.

---

## 3. Residential Arabic Quick-Reference Terms
- **Residential Community / Villa / Apartment:** مجمع سكني / فيلا / شقة
- **Maintenance Request / Emergency Leak:** طلب صيانة / تسرب مياه طارئ
- **Technician Dispatch:** إرسال فني الصيانة
- **Tenancy Contract / Ejari:** عقد الإيجار / إيجاري
- **Move-In / Move-Out Permit:** تصريح الانتقال (دخول / خروج الأثاث)
- **Parking Access / Mulkiya:** تصريح مواقف السيارات / ملكية المركبة
- **Security Deposit:** مبلغ التأمين