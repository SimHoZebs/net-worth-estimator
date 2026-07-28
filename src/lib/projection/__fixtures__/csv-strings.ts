import type { ModelFileContents } from "../types/model";

const accountsHeader = "id,label,minBalance,maxBalance,color,enabled";
const postingsHeader =
	"id,label,sourceAccountId,destinations,arithmetic,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled";

export const validCsvFiles: ModelFileContents = {
	accounts: [
		accountsHeader,
		"checking,Checking,-Infinity,Infinity,#0f172a,true",
		"k401,401(k),-Infinity,Infinity,#2563eb,true",
		"brokerage,Brokerage,-Infinity,Infinity,#16a34a,true",
		"student_loan,Student Loan,-Infinity,0,#dc2626,true",
	].join("\n"),
	behaviors: {
		financialIndependence:
			"instanceId,label,enabled,minimumNetWorth,annualExpenseTarget,annualExpenseGrowthRate,withdrawalRate,evaluationYears,requiredConfidence,sources,continuingPostingIds,principalPolicy",
		netWorthThreshold: [
			"instanceId,label,enabled,target",
			'net-worth-1m,"Reach $1,000,000 net worth",true,1000000',
		].join("\n"),
		postingFulfillment: [
			"instanceId,label,enabled,postingIds",
			"posting-fulfillment,Posting fulfillment,true,null",
		].join("\n"),
	},
	postings: [
		postingsHeader,
		"historical_checking,Historical checking,,checking,14850,once,0,0,0,2026-03-31,,,1,true",
		"historical_k401,Historical 401(k),,k401,119400,once,0,0,0,2026-03-31,,,2,true",
		"historical_brokerage,Historical brokerage,,brokerage,79500,once,0,0,0,2026-03-31,,,3,true",
		"historical_student_loan,Historical student loan,student_loan,,12150,once,0,0,0,2026-03-31,,,4,true",
		"salary,Salary,,checking,15000,monthly,0,0.03,0,2026-04-01,,,1,true",
		"taxes,Taxes,checking,,salary * 0.22,monthly,0,0,0,2026-04-01,,,2,true",
		"housing,Housing,checking,,3200,monthly,0,0.02,0,2026-04-05,,,3,true",
		"k401_employee,401(k) Employee,checking,k401,salary * 0.1,monthly,0,0,0,2026-04-15,,23000,4,true",
		"k401_match,401(k) Match,,k401,k401_employee * 0.5,monthly,0,0,0,2026-04-15,,,5,true",
		"brokerage_auto,Brokerage Auto,checking,brokerage,500,monthly,0,0,0,2026-04-28,,,6,true",
	].join("\n"),
};

export const postingsHeaderOnly = `${postingsHeader}\n`;

export const nullMinMaxCsvFiles: ModelFileContents = {
	accounts: [accountsHeader, "checking,Checking,,,#0f172a,true"].join("\n"),
	behaviors: validCsvFiles.behaviors,
	postings: [
		postingsHeader,
		"historical_checking,Historical checking,,checking,1000,once,0,0,0,2026-03-31,,,1,true",
		"salary,Salary,,checking,1000,monthly,0,0,0,2026-04-01,,,1,true",
	].join("\n"),
};
