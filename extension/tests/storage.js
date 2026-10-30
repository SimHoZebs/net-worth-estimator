export function memoryStorage() {
  const area = () => {
    const data = {};
    return {
      async get(keys) {
        return structuredClone(
          Object.fromEntries(
            []
              .concat(keys)
              .filter((key) => key in data)
              .map((key) => [key, data[key]]),
          ),
        );
      },
      async set(values) {
        Object.assign(data, structuredClone(values));
      },
      async remove(keys) {
        for (const key of [].concat(keys)) delete data[key];
      },
    };
  };
  return { local: area(), session: area() };
}
