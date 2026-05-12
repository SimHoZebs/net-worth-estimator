import type { ScenarioFileContents } from "../types/scenario";

const accountsHeader = "id,label,minBalance,maxBalance,color,enabled";
const postingsHeader =
	"id,label,sourceAccountId,destinations,arithmetic,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled";

export const validCsvFiles: ScenarioFileContents = {
	accounts: [
		accountsHeader,
		"checking,Checking,-Infinity,Infinity,#0f172a,true",
		"k401,401(k),-Infinity,Infinity,#2563eb,true",
		"brokerage,Brokerage,-Infinity,Infinity,#16a34a,true",
		"student_loan,Student Loan,-Infinity,0,#dc2626,true",
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
		"salary,Salary,,checking,15000,monthly,0,0.03,0,2026-04-01,,,1,true",
		"taxes,Taxes,checking,,salary * 0.22,monthly,0,0,0,2026-04-01,,,2,true",
		"housing,Housing,checking,,3200,monthly,0,0.02,0,2026-04-05,,,3,true",
		"k401_employee,401(k) Employee,checking,k401,salary * 0.1,monthly,0,0,0,2026-04-15,,23000,4,true",
		"k401_match,401(k) Match,,k401,k401_employee * 0.5,monthly,0,0,0,2026-04-15,,,5,true",
		"brokerage_auto,Brokerage Auto,checking,brokerage,500,monthly,0,0,0,2026-04-28,,,6,true",
	].join("\n"),
};

export const postingsHeaderOnly = `${postingsHeader}\n`;

export const nullMinMaxCsvFiles: ScenarioFileContents = {
	accounts: [accountsHeader, "checking,Checking,,,#0f172a,true"].join("\n"),
	checkpoints: ["Date,AccountId,Balance", "2026-03-31,checking,1000"].join(
		"\n",
	),
	postings: [
		postingsHeader,
		"salary,Salary,,checking,1000,monthly,0,0,0,2026-04-01,,,1,true",
	].join("\n"),
};
