import type { ScenarioFileContents } from "../types/scenario";

const accountsHeader = "id,label,category,openingBalance,annualRate,volatility,minBalance,maxBalance,color,enabled";
const postingsHeader = "id,label,sourceAccountId,destinations,amountMode,basePostingId,absBase,amount,annualGrowthRate,startDate,endDate,annualCap,priority,enabled";

export const validCsvFiles: ScenarioFileContents = {
  accounts: [
    accountsHeader,
    "checking,Checking,checking,15000,0.01,0,,,#0f172a,true",
    "k401,401(k),401k,120000,0.07,0.15,,,#2563eb,true",
    "brokerage,Brokerage,brokerage,80000,0.07,0.18,,,#16a34a,true",
    "student_loan,Student Loan,loan,-12000,0.05,0,,0,#dc2626,true",
  ].join("\n"),
  checkpoints: [
    "Date,AccountId,Balance",
    "2026-03-31,checking,14850",
    "2026-03-31,k401,119400",
    "2026-03-31,brokerage,79500",
    "2026-03-31,student_loan,-12150",
  ].join("\n"),
  postings: [
    postingsHeader,
    "salary,Salary,,checking,fixed,,false,15000,0.03,2026-04-01,,,1,true",
    "taxes,Taxes,checking,,percent_of_base,salary,false,0.22,0,2026-04-01,,,2,true",
    "housing,Housing,checking,,fixed,,false,3200,0.02,2026-04-05,,,3,true",
    "k401_employee,401(k) Employee,checking,k401,percent_of_base,salary,false,0.1,0,2026-04-15,,23000,4,true",
    "k401_match,401(k) Match,,k401,percent_of_base,k401_employee,false,0.5,0,2026-04-15,,,5,true",
    "brokerage_auto,Brokerage Auto,checking,brokerage,fixed,,false,500,0,2026-04-28,,,6,true",
  ].join("\n"),
};

export const postingsHeaderOnly = `${postingsHeader}\n`;
