import { AsyncIterationDetector } from '../../src/transformer/detector';

describe('AsyncIterationDetector', () => {
	let detector: AsyncIterationDetector;

	beforeEach(() => {
		detector = new AsyncIterationDetector();
	});

	describe('for-of loops with await', () => {
		it('should detect for-of loop with await inside', () => {
			const code = `
        for (const item of items) {
          await atp.llm.call({ prompt: item });
        }
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('for-of-await');
		});

		it('should not detect for-of loop without await', () => {
			const code = `
        for (const item of items) {
          console.log(item);
        }
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(false);
			expect(result.patterns).not.toContain('for-of-await');
		});

		it('should detect nested for-of with await', () => {
			const code = `
        for (const outer of outerItems) {
          for (const inner of innerItems) {
            await api.process(outer, inner);
          }
        }
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('for-of-await');
		});
	});

	describe('while loops with await', () => {
		it('should detect while loop with await inside', () => {
			const code = `
        while (condition) {
          await atp.llm.call({ prompt: 'test' });
        }
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('while-await');
		});

		it('should not detect while loop without await', () => {
			const code = `
        while (condition) {
          console.log('test');
        }
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(false);
			expect(result.patterns).not.toContain('while-await');
		});
	});

	describe('array.map with async callback', () => {
		it('should detect map with async callback', () => {
			const code = `
        const results = items.map(async (item) => {
          return await atp.llm.call({ prompt: item });
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('map-async');
		});

		it('should not detect map with sync callback', () => {
			const code = `
        const results = items.map((item) => {
          return item * 2;
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(false);
			expect(result.patterns).not.toContain('map-async');
		});
	});

	describe('array.forEach with async callback', () => {
		it('should detect forEach with async callback', () => {
			const code = `
        items.forEach(async (item) => {
          await atp.llm.call({ prompt: item });
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('forEach-async');
		});
	});

	describe('array.filter with async callback', () => {
		it('should detect filter with async callback', () => {
			const code = `
        const filtered = items.filter(async (item) => {
          const result = await atp.llm.call({ prompt: item });
          return result === 'yes';
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('filter-async');
		});
	});

	describe('array.reduce with async callback', () => {
		it('should detect reduce with async callback', () => {
			const code = `
        const sum = items.reduce(async (acc, item) => {
          const result = await atp.llm.call({ prompt: item });
          return acc + result;
        }, 0);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('reduce-async');
		});
	});

	describe('array.find with async callback', () => {
		it('should detect find with async callback', () => {
			const code = `
        const found = items.find(async (item) => {
          const result = await atp.llm.call({ prompt: item });
          return result === 'match';
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('find-async');
		});
	});

	describe('array.some with async callback', () => {
		it('should detect some with async callback', () => {
			const code = `
        const hasMatch = items.some(async (item) => {
          const result = await atp.llm.call({ prompt: item });
          return result === 'yes';
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('some-async');
		});
	});

	describe('array.every with async callback', () => {
		it('should detect every with async callback', () => {
			const code = `
        const allMatch = items.every(async (item) => {
          const result = await atp.llm.call({ prompt: item });
          return result === 'yes';
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('every-async');
		});
	});

	describe('array.flatMap with async callback', () => {
		it('should detect flatMap with async callback', () => {
			const code = `
        const flattened = items.flatMap(async (item) => {
          const results = await atp.llm.call({ prompt: item });
          return results.split(',');
        });
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('flatMap-async');
		});
	});

	describe('Promise.all', () => {
		it('should detect Promise.all', () => {
			const code = `
        const results = await Promise.all([
          fetch('url1'),
          fetch('url2'),
        ]);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('promise-all');
		});

		it('should detect batchable Promise.all with direct pausable calls', () => {
			const code = `
        const results = await Promise.all([
          atp.llm.call({ prompt: 'Q1' }),
          atp.llm.call({ prompt: 'Q2' }),
          atp.llm.call({ prompt: 'Q3' }),
        ]);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('promise-all');
			expect(result.batchableParallel).toBe(true);
		});

		it('should detect batchable Promise.all with api.client.* calls', () => {
			const code = `
        const results = await Promise.all([
          api.client.toolA({ a: 1 }),
          api.client.toolB({ b: 2 }),
        ]);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('promise-all');
			expect(result.batchableParallel).toBe(true);
		});

		it('should detect batchable Promise.all with mixed atp.llm and api.client calls', () => {
			const code = `
        const results = await Promise.all([
          atp.llm.call({ prompt: 'Q1' }),
          api.client.myTool({ input: 'data' }),
        ]);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('promise-all');
			expect(result.batchableParallel).toBe(true);
		});

		it('should not mark Promise.all as batchable with complex logic', () => {
			const code = `
        const results = await Promise.all(
          items.map(async (item) => {
            const step1 = await atp.llm.call({ prompt: item });
            return await process(step1);
          })
        );
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('promise-all');
			expect(result.batchableParallel).toBe(false);
		});
	});

	describe('Promise.allSettled', () => {
		it('should detect Promise.allSettled', () => {
			const code = `
        const results = await Promise.allSettled([
          fetch('url1'),
          fetch('url2'),
        ]);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('promise-allSettled');
		});
	});

	describe('multiple patterns', () => {
		it('should detect multiple patterns in same code', () => {
			const code = `
        for (const item of items) {
          await atp.llm.call({ prompt: item });
        }
        
        const results = items.map(async (item) => {
          return await atp.llm.call({ prompt: item });
        });
        
        const parallel = await Promise.all([
          atp.llm.call({ prompt: 'Q1' }),
          atp.llm.call({ prompt: 'Q2' }),
        ]);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('for-of-await');
			expect(result.patterns).toContain('map-async');
			expect(result.patterns).toContain('promise-all');
			expect(result.batchableParallel).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('should handle empty loops', () => {
			const code = `
        for (const item of items) {
        }
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(false);
		});

		it('should handle malformed code gracefully', () => {
			const code = `this is not valid javascript`;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(false);
			expect(result.patterns).toEqual([]);
		});

		it('should handle code with no async patterns', () => {
			const code = `
        const x = 1;
        const y = 2;
        console.log(x + y);
      `;

			const result = detector.detect(code);

			expect(result.needsTransform).toBe(false);
			expect(result.patterns).toEqual([]);
		});
	});
});
