import type { DataRequest } from "./types";

/**
 * The ten example requests (R01–R10).
 * Placeholder content in the agreed request format — replace with the
 * official example files when they are added to the repository.
 */
export const EXAMPLE_REQUESTS: DataRequest[] = [
  {
    id: "R01",
    applicant: {
      name: "Dr. Anna Berger",
      organisation: "Medical University of Vienna",
      country: "AT",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose: "Scientific research on regional differences in type 2 diabetes care.",
    question:
      "How many adults have type 2 diabetes in each region, what share of them have a recent HbA1c above 7%, and what is their mean BMI?",
    definitions: [
      { term: "Adults", definition: "Patients aged 18 or older on 1 January 2025." },
      { term: "Type 2 diabetes", definition: "At least one diagnosis of type 2 diabetes." },
      { term: "Recent HbA1c", definition: "Latest HbA1c measurement in 2024." },
      { term: "BMI", definition: "Latest body mass index per patient." },
    ],
  },
  {
    id: "R02",
    applicant: {
      name: "Markus Steiner",
      organisation: "Alpina Versicherung AG",
      country: "AT",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose:
      "Adjust health insurance premiums for customers based on regional chronic disease rates.",
    question: "What is the prevalence of heart failure per region and age band?",
    definitions: [
      { term: "Heart failure", definition: "Any diagnosis of heart failure." },
      { term: "Age bands", definition: "18–39, 40–64, 65+." },
    ],
  },
  {
    id: "R03",
    applicant: {
      name: "Prof. Lukas Wagner",
      organisation: "Austrian Institute for Public Health",
      country: "AT",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose: "Public health monitoring of hypertension treatment by age.",
    question:
      "Per age band, how many patients have hypertension, what share receive an ACE inhibitor, and what is their mean systolic blood pressure?",
    definitions: [
      { term: "Hypertension", definition: "At least one diagnosis of essential hypertension." },
      { term: "ACE inhibitor", definition: "An active prescription for an ACE inhibitor." },
      { term: "Age bands", definition: "0–17, 18–39, 40–64, 65–79, 80+." },
      { term: "Systolic blood pressure", definition: "Latest measurement per patient." },
    ],
  },
  {
    id: "R04",
    applicant: {
      name: "Sophie Klein",
      organisation: "PharmaReach Marketing GmbH",
      country: "DE",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose:
      "Target an advertising campaign for a new statin at regions with many untreated patients.",
    question: "How many patients with high cholesterol are not on a statin, per region?",
    definitions: [
      { term: "High cholesterol", definition: "LDL above 160 mg/dl in the last year." },
      { term: "Statin", definition: "Any active statin prescription." },
    ],
  },
  {
    id: "R05",
    applicant: {
      name: "Dr. Elena Hofer",
      organisation: "Graz Centre for Diabetes Research",
      country: "AT",
    },
    requested_as: "records",
    requested_format: "pseudonymised_records",
    purpose:
      "Scientific research: develop a model that predicts insulin initiation in type 2 diabetes.",
    question:
      "Which patterns in medication history and HbA1c trajectories precede the start of insulin therapy?",
    justification:
      "The model needs individual medication sequences and HbA1c time series per patient. Aggregated statistics cannot capture the order and timing of events, which is the core of the research question.",
    definitions: [
      { term: "Cohort", definition: "Adults with type 2 diabetes and at least 3 HbA1c values." },
      { term: "Record types", definition: "Conditions, medications, HbA1c observations." },
    ],
  },
  {
    id: "R06",
    applicant: {
      name: "Thomas Gruber",
      organisation: "Gruber Personal Consulting",
      country: "AT",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose:
      "Help employers screen job applicants for conditions that cause long sick leave.",
    question: "How common are depression and back pain among working-age adults per region?",
    definitions: [
      { term: "Working-age adults", definition: "Patients aged 18–64." },
      { term: "Depression", definition: "Any diagnosis of a depressive episode." },
    ],
  },
  {
    id: "R07",
    applicant: {
      name: "Dr. Julia Moser",
      organisation: "Federal Ministry of Health",
      country: "AT",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose: "Health system planning: COPD burden per hospital.",
    question: "How many patients with COPD are treated at each hospital?",
    definitions: [
      { term: "COPD", definition: "At least one diagnosis of chronic obstructive pulmonary disease." },
      { term: "Hospital", definition: "The data holder of the patient." },
    ],
  },
  {
    id: "R08",
    applicant: {
      name: "Dr. Felix Huber",
      organisation: "Innsbruck Medical University",
      country: "AT",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose: "Scientific research on obesity and kidney function.",
    question:
      "Per region, how many adults have obesity, what share also have chronic kidney disease, and what is their mean eGFR?",
    definitions: [
      { term: "Obesity", definition: "Latest BMI of 30 or higher." },
      { term: "Chronic kidney disease", definition: "Any diagnosis of CKD stage 3 or higher." },
      { term: "eGFR", definition: "Latest estimated glomerular filtration rate." },
    ],
  },
  {
    id: "R09",
    applicant: {
      name: "Dr. Clara Fischer",
      organisation: "Linz Heart Institute",
      country: "AT",
    },
    requested_as: "records",
    requested_format: "pseudonymised_records",
    purpose: "Scientific research on atrial fibrillation and anticoagulation.",
    question:
      "What share of patients with atrial fibrillation receive an oral anticoagulant, per age band?",
    justification: "We would like the full records to be flexible in our analysis.",
    definitions: [
      { term: "Atrial fibrillation", definition: "Any diagnosis of atrial fibrillation or flutter." },
      { term: "Oral anticoagulant", definition: "Active prescription of a DOAC or vitamin K antagonist." },
      { term: "Age bands", definition: "18–64, 65–74, 75–84, 85+." },
    ],
  },
  {
    id: "R10",
    applicant: {
      name: "Martin Bauer",
      organisation: "Nordic Vapour Products Ltd",
      country: "SE",
    },
    requested_as: "statistics",
    requested_format: "aggregated_table",
    purpose:
      "Product development for a new nicotine pouch aimed at young adults.",
    question:
      "How many smokers are there per region and age band, and how many tried to quit?",
    definitions: [
      { term: "Smoker", definition: "Current tobacco use recorded in the last 2 years." },
      { term: "Age bands", definition: "16–24, 25–34, 35+." },
    ],
  },
];

export const REQUIRED_FIELDS = [
  "id",
  "applicant",
  "requested_as",
  "requested_format",
  "purpose",
  "question",
  "definitions",
] as const;
