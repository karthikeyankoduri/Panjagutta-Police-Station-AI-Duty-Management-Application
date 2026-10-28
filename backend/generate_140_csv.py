"""
Generate Panjagutta Police Station 140-personnel CSV dataset.
Includes:
- 1 SHO (Inspector)
- 1 DI (Detective Inspector)
- 1 Admin SI
- 1 Duty SI (DSI)
- 5 Sector SIs (Sectors 1 to 5)
- 8 Specialized SIs/WSIs (Law & Order, Crime, Traffic, Cyber, Women Desk)
- 10 ASIs / AWSIs (Court In-charges, Section In-charges)
- 20 HCs / WHCs (Crime assistants, Blue Colts, Court)
- 60 PCs / WPCs (Beat Constables, Summons, Warrants, JFCM, Reception, eCOPS, CCTNS, Station Writers)
- 12 ARPCs / ARWPCs (Armory, Sentry, Prisoner Escort)
- 10 Drivers (SHO, DI, Pilot, Sector Patrols 1-5, Rakshak)
- 7 Home Guards (HGS / WHGS)
- 4 Special Police Officers (SPOs)
Total: 140 Staff Members with linked User Accounts
"""
import csv
import os

FIRST_NAMES = [
    "Ramesh", "Venkatesh", "Priya", "Anil", "Sunita", "Mohammed", "Lakshmi", "Rajesh", "Srinivas", "Deepa",
    "Suresh", "Anitha", "Ravi", "Kavitha", "Nagaraju", "Vasantha", "Rekha", "Balakrishna", "Nagamma", "Syed",
    "Kalyan", "Chandra", "Swathi", "Prashanth", "Padma", "Madhu", "Lavanya", "Bhikshapathi", "Sandhya", "Satish",
    "Manjula", "Santosh", "Sarojini", "Raghu", "Sujatha", "Mahesh", "Sharada", "Gopal", "Hemalatha", "Praveen",
    "Geetha", "Naresh", "Aruna", "Sridhar", "Bhagya", "Vijay", "Usha", "Vinod", "Jyothi", "Dharma",
    "Roopa", "Kiran", "Bhavani", "Shekar", "Saroja", "Harish", "Aparna", "Thirupathi", "Shilpa", "Mallaiah",
    "Varalaxmi", "Venu", "Shailaja", "Anjaiah", "Sirisha", "Narsing", "Sumalatha", "Naveen", "Pushpa", "Raju",
    "Kanakadurga", "Krishna", "Renuka", "Devender", "Latha", "Jitender", "Kiranmayi", "Balaraju", "Vanaja", "Shyam",
    "Uma", "Mallesham", "Vijaya", "Srikanth", "Radha", "Ravinder", "Mamatha", "Pradeep", "Madhavi", "Goutham",
    "Kausalya", "Shravan", "Chandrakala", "Upender", "Pooja", "Jagan", "Nirmala", "Ramakrishna", "Rajini", "Sai"
]

LAST_NAMES = [
    "Kumar", "Reddy", "Sharma", "Goud", "Rao", "Yadav", "Devi", "Begum", "Irfan", "Narayana",
    "Babu", "Murthy", "Kumari", "Shankar", "Verma", "Hussain", "Chary", "Naidu", "Vandana", "Patel",
    "Mudhiraj", "Padmashali", "Nayaka", "Singh", "Jadhav", "Bano", "Ali", "Chauhan", "Gupta", "Rathod",
    "Nayak", "Kaur", "Tiwari", "Das", "Menon", "Pillai", "Joshi", "Chatterjee", "Achary", "Swamy"
]

def generate_140():
    staff = []
    current_id = 1

    # 1. SHO (1)
    staff.append({
        "service_number": "PJ-SHO-001",
        "name": "E Jahangir Yadav",
        "designation": "INSPECTOR",
        "category": "SECTION_DUTY",
        "sector": "",
        "section": "Station Executive",
        "contact_phone": "8919083904",
        "dept_phone": "8712660498",
        "employee_id": "1417195",
        "email": "eeraboinajahangeer@gmail.com",
        "date_of_joining": "2010-06-01",
        "username": "sho_panjagutta",
        "password": "Password@PJ2024!",
        "role": "SHO",
        "notes": "Station House Officer - Overall Station In-charge"
    })
    current_id += 1

    # 2. Detective Inspector (DI) (1)
    staff.append({
        "service_number": "PJ-DI-001",
        "name": "Anand Reddy K",
        "designation": "INSPECTOR",
        "category": "SECTION_DUTY",
        "sector": "",
        "section": "Crime / Investigation",
        "contact_phone": "9848012002",
        "date_of_joining": "2012-08-15",
        "username": "di_panjagutta",
        "password": "Password@PJ2024!",
        "role": "DI",
        "notes": "Detective Officer - Head of Station Investigations"
    })
    current_id += 1

    # 3. Admin SI (1)
    staff.append({
        "service_number": "PJ-ADSI-001",
        "name": "Venkatesh Goud M",
        "designation": "SI",
        "category": "SECTION_DUTY",
        "sector": "",
        "section": "Station Administration",
        "contact_phone": "9848012003",
        "date_of_joining": "2015-01-10",
        "username": "admin_si_panjagutta",
        "password": "Password@PJ2024!",
        "role": "ADMIN_SI",
        "notes": "Admin Sub-Inspector - Rosters, muster roll & staff allocation"
    })
    current_id += 1

    # 4. Duty SI (DSI) (1)
    staff.append({
        "service_number": "PJ-DSI-001",
        "name": "K. Srinivas Murthy",
        "designation": "SI",
        "category": "SECTION_DUTY",
        "sector": "",
        "section": "Station Watch & Roll Call",
        "contact_phone": "9848012004",
        "date_of_joining": "2016-04-20",
        "username": "dsi_panjagutta",
        "password": "Password@PJ2024!",
        "role": "DSI",
        "notes": "Duty Sub-Inspector - Daily station watch & sentry checks"
    })
    current_id += 1

    # 5. Sector SIs (5)
    sector_si_names = [
        ("Priya Sharma", "WSI", "sec1_si_panjagutta"),
        ("Mohammed Abdul Razzak", "SI", "sec2_si_panjagutta"),
        ("Sunita Bai", "WSI", "sec3_si_panjagutta"),
        ("Ch. Rajeshwar Rao", "SI", "sec4_si_panjagutta"),
        ("P. Venkateshwarlu", "SI", "sec5_si_panjagutta"),
    ]
    for idx, (name, desig, uname) in enumerate(sector_si_names, start=1):
        staff.append({
            "service_number": f"PJ-SEC{idx}-SI",
            "name": name,
            "designation": desig,
            "category": "SECTOR_STAFF",
            "sector": str(idx),
            "section": f"Sector {idx} Field Operations",
            "contact_phone": f"98480120{10+idx}",
            "date_of_joining": f"2016-0{idx}-15",
            "username": uname,
            "password": "Password@PJ2024!",
            "role": "SECTOR_SI",
            "notes": f"Sector {idx} Sub-Inspector Field In-charge"
        })
        current_id += 1

    # 6. Specialized Wing SIs (8)
    special_sis = [
        ("K. Mahender Reddy", "SI", "Law & Order", "pj_si_lo1"),
        ("D. Suresh Kumar", "SI", "Law & Order", "pj_si_lo2"),
        ("M. Krishna Murthy", "SI", "Crime", "pj_si_crime1"),
        ("T. Ravinder Yadav", "SI", "Crime", "pj_si_crime2"),
        ("V. Bhaskar Rao", "SI", "Traffic", "pj_si_traffic1"),
        ("B. Swapna Reddy", "WSI", "Traffic", "pj_si_traffic2"),
        ("G. Sandeep Kumar", "SI", "Cyber Cell", "pj_si_cyber"),
        ("R. Madhavi Latha", "WSI", "Women Help Desk", "pj_wsi_women"),
    ]
    for idx, (name, desig, sec, uname) in enumerate(special_sis, start=1):
        staff.append({
            "service_number": f"PJ-SPEC-SI{idx:02d}",
            "name": name,
            "designation": desig,
            "category": "SECTION_DUTY",
            "sector": "",
            "section": sec,
            "contact_phone": f"98480120{20+idx}",
            "date_of_joining": f"2017-0{min(idx,9)}-10",
            "username": uname,
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": f"Specialized Wing SI - {sec}"
        })
        current_id += 1

    # 7. ASIs / AWSIs (10)
    asi_data = [
        ("B. Satyanarayana", "ASI", "Court", "Sessions Court In-charge"),
        ("K. Lakshmi Devi", "AWSI", "Court", "Sessions Court Liaison"),
        ("G. Narsimha Chary", "ASI", "Section In-charges", "Station Armory In-charge"),
        ("P. Mallesh Yadav", "ASI", "Section In-charges", "Muster & Warrant Registry"),
        ("S. Yadagiri Goud", "ASI", "Section In-charges", "Summons Monitoring"),
        ("T. Ramulu", "ASI", "Sector 1 Operations", "Sector 1 Supervisory ASI"),
        ("N. Shanker Rao", "ASI", "Sector 2 Operations", "Sector 2 Supervisory ASI"),
        ("C. Renuka", "AWSI", "Sector 3 Operations", "Sector 3 Supervisory AWSI"),
        ("M. David Raju", "ASI", "Sector 4 Operations", "Sector 4 Supervisory ASI"),
        ("K. Sitaram", "ASI", "Sector 5 Operations", "Sector 5 Supervisory ASI"),
    ]
    for idx, (name, desig, sec, duty_desc) in enumerate(asi_data, start=1):
        sector_val = str(idx - 5) if idx > 5 else ""
        staff.append({
            "service_number": f"PJ-ASI-{idx:03d}",
            "name": name,
            "designation": desig,
            "category": "SECTOR_STAFF" if sector_val else "SECTION_DUTY",
            "sector": sector_val,
            "section": sec,
            "contact_phone": f"98480120{30+idx}",
            "date_of_joining": f"2013-0{min(idx,9)}-05",
            "username": f"pj_asi_{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty_desc
        })
        current_id += 1

    # 8. Head Constables / WHCs (20)
    hc_categories = [
        ("Sessions Court Staff", "Court", ""),
        ("Sessions Court Staff", "Court", ""),
        ("JFCM Court HC", "Court", ""),
        ("Summons HC", "Court", ""),
        ("Warrants HC", "Court", ""),
        ("Crime Branch HC", "Crime", ""),
        ("Crime Branch HC", "Crime", ""),
        ("Crime Investigation HC", "Crime", ""),
        ("Surveillance HC", "Crime", ""),
        ("Blue Colts HC - Sector 1", "Patrol Vehicles", "1"),
        ("Blue Colts HC - Sector 2", "Patrol Vehicles", "2"),
        ("Blue Colts HC - Sector 3", "Patrol Vehicles", "3"),
        ("Blue Colts HC - Sector 4", "Patrol Vehicles", "4"),
        ("Blue Colts HC - Sector 5", "Patrol Vehicles", "5"),
        ("Patrol Vehicle Mobile In-charge", "Patrol Vehicles", "1"),
        ("Patrol Vehicle Mobile In-charge", "Patrol Vehicles", "2"),
        ("Patrol Vehicle Mobile In-charge", "Patrol Vehicles", "3"),
        ("Patrol Vehicle Mobile In-charge", "Patrol Vehicles", "4"),
        ("Patrol Vehicle Mobile In-charge", "Patrol Vehicles", "5"),
        ("Station Sentry HC", "General Duty", "")
    ]
    for idx, (duty_name, sec, sec_num) in enumerate(hc_categories, start=1):
        is_women = idx in [2, 7, 12, 17]
        desig = "WHC" if is_women else "HC"
        name = f"{FIRST_NAMES[(idx * 3) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 2) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-HC-{idx:03d}",
            "name": name,
            "designation": desig,
            "category": "SECTOR_STAFF" if sec_num else "SECTION_DUTY",
            "sector": sec_num,
            "section": sec,
            "contact_phone": f"98480121{idx:02d}",
            "date_of_joining": f"2014-{(idx%12)+1:02d}-12",
            "username": f"pj_hc_{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty_name
        })
        current_id += 1

    # 9. Police Constables / WPCs (60)
    # Specified in PDF: Summons 2, Warrants 2, JFCM 2, Reception 2, eCOPS 2, CCTNS 1, Station Writers 2
    # Beat Constables per shift (A, B, C) x 5 sectors = 4 per shift x 3 shifts = 12 per sector
    pc_special_duties = [
        ("Court Summons Execution PC", "Court", ""),
        ("Court Summons Execution PC", "Court", ""),
        ("Court Warrants Execution PC", "Court", ""),
        ("Court Warrants Execution PC", "Court", ""),
        ("JFCM Court Staff PC", "Court", ""),
        ("JFCM Court Staff PC", "Court", ""),
        ("Front Office Receptionist PC", "Reception", ""),
        ("Front Office Receptionist WPC", "Reception", ""),
        ("eCOPS Data Operator PC", "eCOPS", ""),
        ("eCOPS Data Operator WPC", "eCOPS", ""),
        ("CCTNS Station Writer PC", "CCTNS", ""),
        ("General Station Writer PC", "Station Writer", ""),
        ("Assistant Station Writer WPC", "Station Writer", ""),
    ]
    # Add special PCs
    for idx, (duty, sec, sec_num) in enumerate(pc_special_duties, start=1):
        is_wpc = "WPC" in duty
        desig = "WPC" if is_wpc else "PC"
        name = f"{FIRST_NAMES[(idx * 5) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 4) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-PC-S{idx:02d}",
            "name": name,
            "designation": desig,
            "category": "SECTION_DUTY",
            "sector": sec_num,
            "section": sec,
            "contact_phone": f"98480122{idx:02d}",
            "date_of_joining": f"2018-{(idx%12)+1:02d}-01",
            "username": f"pj_pc_s{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty
        })
        current_id += 1

    # Remaining 47 PCs distributed across 5 Sectors as Beat Constables
    # 5 sectors x ~9-10 PCs per sector
    for idx in range(14, 61):
        sector_id = ((idx - 14) % 5) + 1
        is_wpc = (idx % 4 == 0)
        desig = "WPC" if is_wpc else "PC"
        name = f"{FIRST_NAMES[(idx * 7) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 3) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-PC-{idx:03d}",
            "name": name,
            "designation": desig,
            "category": "SECTOR_STAFF",
            "sector": str(sector_id),
            "section": f"Sector {sector_id} Beats",
            "contact_phone": f"98480123{idx:02d}",
            "date_of_joining": f"2019-{(idx%12)+1:02d}-15",
            "username": f"pj_pc_{idx:03d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": f"Sector {sector_id} Beat Patrol Constable"
        })
        current_id += 1

    # 10. Armed Reserve Constables (ARPCs / ARWPCs) (12)
    for idx in range(1, 13):
        is_wpc = idx in [4, 8, 12]
        desig = "ARWPC" if is_wpc else "ARPC"
        duty = "Armory Sentry Guard" if idx <= 4 else ("Prisoner Escort Guard" if idx <= 8 else "Striking Reserve Force")
        name = f"{FIRST_NAMES[(idx * 11) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 6) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-ARPC-{idx:02d}",
            "name": name,
            "designation": desig,
            "category": "SECTION_DUTY",
            "sector": "",
            "section": "Armed Reserve Guard",
            "contact_phone": f"98480124{idx:02d}",
            "date_of_joining": f"2017-{(idx%12)+1:02d}-20",
            "username": f"pj_arpc_{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty
        })
        current_id += 1

    # 11. Police Drivers (10)
    driver_roles = [
        "SHO Vehicle Official Driver",
        "DI Vehicle Official Driver",
        "Pilot Mobile Patrol Driver",
        "Sector 1 Patrol Vehicle Driver",
        "Sector 2 Patrol Vehicle Driver",
        "Sector 3 Patrol Vehicle Driver",
        "Sector 4 Patrol Vehicle Driver",
        "Sector 5 Patrol Vehicle Driver",
        "Rakshak Mobile 1 Driver",
        "Rakshak Mobile 2 Driver"
    ]
    for idx, duty in enumerate(driver_roles, start=1):
        sector_val = str(idx - 3) if 4 <= idx <= 8 else ""
        name = f"{FIRST_NAMES[(idx * 13) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 7) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-DRV-{idx:02d}",
            "name": name,
            "designation": "PC",
            "category": "DRIVER",
            "sector": sector_val,
            "section": "Motor Transport",
            "contact_phone": f"98480125{idx:02d}",
            "date_of_joining": f"2016-{(idx%12)+1:02d}-10",
            "username": f"pj_drv_{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty
        })
        current_id += 1

    # 12. Home Guards (HGS / WHGS) (7)
    for idx in range(1, 8):
        is_whgs = idx in [3, 6]
        desig = "WHGS" if is_whgs else "HGS"
        duty = "Front Office Assistance" if idx <= 2 else ("Traffic Congestion Point Duty" if idx <= 5 else "Night Picket Support")
        name = f"{FIRST_NAMES[(idx * 17) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 9) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-HG-{idx:02d}",
            "name": name,
            "designation": desig,
            "category": "SECTION_DUTY",
            "sector": str(((idx-1)%5)+1) if idx > 4 else "",
            "section": "Auxiliary Staff",
            "contact_phone": f"98480126{idx:02d}",
            "date_of_joining": f"2020-{(idx%12)+1:02d}-01",
            "username": f"pj_hg_{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty
        })
        current_id += 1

    # 13. Special Police Officers (SPOs) (4)
    for idx in range(1, 5):
        duty = f"Special Police Officer - Sector {idx} Community Liaison"
        name = f"{FIRST_NAMES[(idx * 19) % len(FIRST_NAMES)]} {LAST_NAMES[(idx * 11) % len(LAST_NAMES)]}"
        staff.append({
            "service_number": f"PJ-SPO-{idx:02d}",
            "name": name,
            "designation": "SPO",
            "category": "SECTION_DUTY",
            "sector": str(idx),
            "section": "Community Policing",
            "contact_phone": f"98480127{idx:02d}",
            "date_of_joining": f"2021-0{idx}-01",
            "username": f"pj_spo_{idx:02d}",
            "password": "Password@PJ2024!",
            "role": "STAFF",
            "notes": duty
        })
        current_id += 1

    return staff

if __name__ == "__main__":
    raw_list = generate_140()
    print(f"Generated {len(raw_list)} staff records.")

    os.makedirs("data", exist_ok=True)
    csv_path = os.path.join("data", "panjagutta_140_police_staff.csv")
    public_csv_path = os.path.join("..", "frontend", "public", "panjagutta_140_police_staff.csv")

    fieldnames = [
        "S.No", "Range", "Zone", "Division", "Police Station",
        "PG ID", "Employee ID", "Rank", "General No",
        "Employee name", "Mobile no (personal)", "Department No",
        "Mother Tongue", "E-mail ID", "Category", "Sector",
        "Section", "Username", "Role", "Password"
    ]

    rank_map = {
        "INSPECTOR": "Inspector",
        "SI": "Sub-Inspector",
        "WSI": "Women Sub-Inspector",
        "ASI": "Assistant Sub-Inspector",
        "AWSI": "Women Assistant Sub-Inspector",
        "HC": "Head Constable",
        "WHC": "Women Head Constable",
        "PC": "Police Constable",
        "WPC": "Women Police Constable",
        "ARPC": "Armed Reserve Police Constable",
        "ARWPC": "Armed Reserve Women Police Constable",
        "HGS": "Home Guard",
        "WHGS": "Women Home Guard",
        "SPO": "Special Police Officer"
    }

    formatted_rows = []
    for idx, r in enumerate(raw_list, start=1):
        desig = r["designation"]
        gen_no = ""
        if "PC" in desig:
            gen_no = f"PC {1000 + idx}"
        elif "HC" in desig:
            gen_no = f"HC {200 + idx}"

        emp_id = r.get("employee_id") or str(1417195 + idx - 1)
        dept_no = r.get("dept_phone") or f"87126604{97 + idx:02d}"
        email = r.get("email") or f"{r['username']}@telanganapolice.gov.in"

        formatted_rows.append({
            "S.No": idx,
            "Range": "Charminar",
            "Zone": "Khairatabad",
            "Division": "Panjagutta",
            "Police Station": "Panjagutta",
            "PG ID": f"pg-{idx:03d}",
            "Employee ID": emp_id,
            "Rank": rank_map.get(desig, desig),
            "General No": gen_no,
            "Employee name": r["name"],
            "Mobile no (personal)": r["contact_phone"],
            "Department No": dept_no,
            "Mother Tongue": "Telugu",
            "E-mail ID": email,
            "Category": r.get("category", "SECTION_DUTY"),
            "Sector": r.get("sector", ""),
            "Section": r.get("section", ""),
            "Username": r["username"],
            "Role": r["role"],
            "Password": r["password"],
        })

    for p in [csv_path, public_csv_path]:
        try:
            target_dir = os.path.dirname(p)
            if target_dir:
                os.makedirs(target_dir, exist_ok=True)
            with open(p, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                for row in formatted_rows:
                    writer.writerow(row)
            print(f"Successfully written to {p}")
        except Exception as e:
            print(f"Error writing to {p}: {e}")
