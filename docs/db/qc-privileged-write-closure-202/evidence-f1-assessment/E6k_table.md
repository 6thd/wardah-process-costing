| Variant (B) | Fixture | Query | n | M199 p50 / p90 / max (ms) | B p50 / p90 / max (ms) | B/M199 p50 |
|---|---|---|---|---|---|---|
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 393.8 / 421.0 / 428.9 | 1568.9 / 1643.2 / 1666.0 | 3.98x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 5/MO | org-wide limit 500 | 25 | 399.5 / 444.0 / 451.5 | 1559.3 / 1637.4 / 1718.1 | 3.90x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.2 / 1.6 / 1.7 | 2.1 / 3.7 / 4.6 | 1.73x |
| OLD M202 (frozen 8babdd6f), default JIT | 5,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 41.0 / 44.4 / 46.5 | 111.1 / 116.0 / 122.0 | 2.71x |
| OLD M202 (frozen 8babdd6f), default JIT | 5,000 rows, 5/MO | org-wide limit 500 | 25 | 42.9 / 47.4 / 75.2 | 112.1 / 118.9 / 134.4 | 2.61x |
| OLD M202 (frozen 8babdd6f), default JIT | 5,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.3 / 1.7 / 2.1 | 2.0 / 3.4 / 3.9 | 1.60x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 250/MO | org-wide limit 100 (default call) | 25 | 379.5 / 401.4 / 410.3 | 1571.0 / 1651.8 / 1723.6 | 4.14x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 250/MO | org-wide limit 500 | 25 | 388.4 / 434.7 / 467.0 | 1610.4 / 1718.9 / 1776.4 | 4.15x |
| OLD M202 (frozen 8babdd6f), default JIT | 50,000 rows, 250/MO | MO-scoped limit 100 | 25 | 3.9 / 4.4 / 4.5 | 58.1 / 60.5 / 65.7 | 14.83x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 393.5 / 432.1 / 451.6 | 591.8 / 626.0 / 649.0 | 1.50x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 5/MO | org-wide limit 500 | 25 | 380.9 / 402.7 / 408.8 | 586.9 / 631.4 / 648.8 | 1.54x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.2 / 1.6 / 1.7 | 2.0 / 3.7 / 3.8 | 1.72x |
| OLD M202, jit=off (diagnostic only) | 5,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 41.4 / 43.8 / 49.7 | 64.3 / 70.1 / 94.2 | 1.55x |
| OLD M202, jit=off (diagnostic only) | 5,000 rows, 5/MO | org-wide limit 500 | 25 | 43.1 / 46.4 / 47.1 | 63.5 / 66.7 / 68.6 | 1.47x |
| OLD M202, jit=off (diagnostic only) | 5,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.1 / 1.5 / 1.7 | 2.0 / 3.4 / 3.5 | 1.77x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 250/MO | org-wide limit 100 (default call) | 25 | 392.4 / 420.7 / 439.2 | 617.7 / 634.5 / 679.6 | 1.57x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 250/MO | org-wide limit 500 | 25 | 387.5 / 408.3 / 451.3 | 621.3 / 661.4 / 670.3 | 1.60x |
| OLD M202, jit=off (diagnostic only) | 50,000 rows, 250/MO | MO-scoped limit 100 | 25 | 3.7 / 3.9 / 4.4 | 6.0 / 7.6 / 8.0 | 1.63x |
| NEW M202 (optimized), default JIT | 50,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 397.7 / 437.9 / 479.4 | 82.1 / 87.8 / 94.2 | 0.21x |
| NEW M202 (optimized), default JIT | 50,000 rows, 5/MO | org-wide limit 500 | 25 | 398.5 / 430.2 / 449.6 | 92.7 / 101.5 / 104.6 | 0.23x |
| NEW M202 (optimized), default JIT | 50,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.1 / 1.5 / 1.6 | 2.4 / 3.4 / 3.6 | 2.20x |
| NEW M202 (optimized), default JIT | 5,000 rows, 5/MO | org-wide limit 100 (default call) | 25 | 40.3 / 46.6 / 50.5 | 12.4 / 14.1 / 15.2 | 0.31x |
| NEW M202 (optimized), default JIT | 5,000 rows, 5/MO | org-wide limit 500 | 25 | 46.5 / 51.0 / 72.2 | 21.1 / 25.1 / 31.9 | 0.45x |
| NEW M202 (optimized), default JIT | 5,000 rows, 5/MO | MO-scoped limit 100 | 25 | 1.3 / 1.7 / 1.9 | 2.4 / 4.0 / 4.7 | 1.86x |
| NEW M202 (optimized), default JIT | 50,000 rows, 250/MO | org-wide limit 100 (default call) | 25 | 378.9 / 394.2 / 400.9 | 105.9 / 115.6 / 127.2 | 0.28x |
| NEW M202 (optimized), default JIT | 50,000 rows, 250/MO | org-wide limit 500 | 25 | 388.2 / 428.0 / 466.8 | 181.5 / 196.6 / 202.1 | 0.47x |
| NEW M202 (optimized), default JIT | 50,000 rows, 250/MO | MO-scoped limit 100 | 25 | 4.0 / 4.4 / 4.8 | 5.1 / 10.6 / 16.9 | 1.29x |
