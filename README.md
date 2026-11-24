# BLOOPS Giving Tuesday Tracker

A small app that runs on your computer to organize Giving Tuesday outreach for Blueprints for Pangaea.

- **Donor list:** import alumni, past officers, current members, gala attendees and past sponsors from `.xlsx` or `.csv` files. People who appear in more than one list are merged by email (or by name) and keep every group tag. Emails marked as bounced are skipped.
- **Campaign and emails:** set the goal, cause, donation link and your name, and edit two emails: a heads-up a few days before, and a donate-today email.
- **Send outreach:** copy addresses for BCC, download a personalized mail-merge CSV, or open a ready-to-send Gmail draft for one person. Track who has been sent each email.
- **Overview:** contacts by group, emails sent, and donations against the goal.
- **Organizations:** researched list of organizations to approach, such as U-M funding, health systems, medical supply companies, Michigan foundations and alumni employers with matching gifts. Each has a point of contact, sources, and a 0–100 likelihood score. The score updates live as alumni in your donor list are linked to their employers.
- **Org outreach:** editable emails for organizations and for alumni at matching-gift employers. Choose organizations with checkboxes, preview, open in Gmail, or download a mail-merge CSV.

The researched list lives in `public/prospects-seed.json`. Edit it (or have it refreshed) and change `researchedOn`, and any open app picks up the changes within 15 seconds.

## Run it

Requires [Node.js](https://nodejs.org) 18 or newer. No packages to install.

```bash
npm start
```

Then open http://localhost:4321.

## Privacy

Everything is saved to `data/db.json` on your computer. The `data/` folder and any `.xlsx` or `.csv` files are in `.gitignore`, so donor names and emails are never committed to this repo.
