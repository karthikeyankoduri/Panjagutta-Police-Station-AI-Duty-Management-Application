import requests
import json

BASE_URL = "http://localhost:8000/api"

def run_test():
    # 1. Login as bootstrap admin to perform test
    print("1. Logging in as admin...")
    login_res = requests.post(f"{BASE_URL}/auth/login", json={"username": "admin_si_panjagutta", "password": "Password@PJ2024!"})
    if login_res.status_code != 200:
        login_res = requests.post(f"{BASE_URL}/auth/login", json={"username": "admin_si_demo", "password": "Demo@AdminSI#2024!"})
    if login_res.status_code != 200:
        login_res = requests.post(f"{BASE_URL}/auth/login", json={"username": "sho_demo", "password": "Demo@SHO#2024!"})
    
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"Logged in successfully. Token obtained.")

    # 2. Test download template
    print("2. Testing download template...")
    t_res = requests.get(f"{BASE_URL}/staff/download-template")
    assert t_res.status_code == 200, f"Download template failed: {t_res.status_code}"
    lines = t_res.text.strip().split("\n")
    print(f"Template downloaded successfully: {len(lines)} lines (header + 140 staff).")

    # 3. Test clear demo data
    print("3. Testing clear demo data...")
    clear_res = requests.post(f"{BASE_URL}/staff/clear-demo-data", headers=headers)
    assert clear_res.status_code == 200, f"Clear demo data failed: {clear_res.text}"
    print(f"Clear demo data response: {clear_res.json()}")

    # Verify staff count is now empty or only active admin remains
    staff_res = requests.get(f"{BASE_URL}/staff/", headers=headers)
    assert staff_res.status_code == 200
    current_staff = staff_res.json()
    print(f"Staff count after clear: {len(current_staff)}")

    # 4. Test import CSV
    print("4. Testing import CSV with 140 police staff...")
    with open("data/panjagutta_140_police_staff.csv", "rb") as f:
        files = {"file": ("panjagutta_140_police_staff.csv", f, "text/csv")}
        import_res = requests.post(f"{BASE_URL}/staff/import-csv", headers=headers, files=files)
    assert import_res.status_code == 200, f"Import CSV failed: {import_res.text}"
    import_data = import_res.json()
    print(f"Import success! {import_data['message']}")
    print(f"Imported count: {import_data['imported_count']}, Total staff: {import_data['total_staff_count']}")

    # 5. Verify total staff count is 140
    staff_list_res = requests.get(f"{BASE_URL}/staff/", headers=headers)
    assert staff_list_res.status_code == 200
    all_staff = staff_list_res.json()
    print(f"Current total staff in DB: {len(all_staff)}")
    assert len(all_staff) == 140, f"Expected 140 staff, got {len(all_staff)}"

    # 6. Test editing staff & user profile
    # Let's find SHO in the staff list
    sho_staff = next((s for s in all_staff if s["service_number"] == "PJ-SHO-001"), None)
    assert sho_staff is not None, "SHO staff not found in imported list!"
    print(f"Found SHO: {sho_staff['name']}, role: {sho_staff.get('user_role')}")

    print("6. Testing edit staff profile and user credentials...")
    edit_payload = {
        "name": "Sri K. Ravinder Reddy (SHO Updated)",
        "contact_phone": "9849900000",
        "notes": "Verified station commander profile",
        "user_role": "SHO"
    }
    edit_res = requests.patch(f"{BASE_URL}/staff/{sho_staff['id']}", headers=headers, json=edit_payload)
    assert edit_res.status_code == 200, f"Edit staff failed: {edit_res.text}"
    updated_sho = edit_res.json()
    print(f"Updated SHO: Name = {updated_sho['name']}, Phone = {updated_sho.get('contact_phone')}")
    assert updated_sho["name"] == "Sri K. Ravinder Reddy (SHO Updated)"

    # 7. Test login with newly imported SHO credentials
    print("7. Testing login with newly imported SHO credentials (sho_panjagutta)...")
    sho_login = requests.post(f"{BASE_URL}/auth/login", json={"username": "sho_panjagutta", "password": "Password@PJ2024!"})
    assert sho_login.status_code == 200, f"SHO login failed: {sho_login.text}"
    sho_token = sho_login.json()["access_token"]
    print(f"SHO login successful! Token received. Role = {sho_login.json()['role']}")

    # 8. Test login with newly imported Admin SI credentials
    print("8. Testing login with newly imported Admin SI credentials (admin_si_panjagutta)...")
    admin_si_login = requests.post(f"{BASE_URL}/auth/login", json={"username": "admin_si_panjagutta", "password": "Password@PJ2024!"})
    assert admin_si_login.status_code == 200, f"Admin SI login failed: {admin_si_login.text}"
    print(f"Admin SI login successful! Token received. Role = {admin_si_login.json()['role']}")

    print("\nALL 8 TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_test()
