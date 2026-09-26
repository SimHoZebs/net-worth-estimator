export const textValue = (data: FormData, name: string) =>
	String(data.get(name) ?? "").trim();
export const numberValue = (data: FormData, name: string) =>
	Number(textValue(data, name));
