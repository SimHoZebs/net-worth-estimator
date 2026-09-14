import { financialIndependenceEvaluation } from "./financialIndependence";
import { netWorthThresholdEvaluation } from "./netWorthThreshold";
import { postingFulfillmentEvaluation } from "./postingFulfillment";
import { EvaluationRegistry } from "./runtime";

export const evaluationRegistry = new EvaluationRegistry();

evaluationRegistry.register(financialIndependenceEvaluation);
evaluationRegistry.register(netWorthThresholdEvaluation);
evaluationRegistry.register(postingFulfillmentEvaluation);
